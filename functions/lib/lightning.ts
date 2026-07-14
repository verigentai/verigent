// Lightning payment integration via Nightosphere CLN node.
// Uses cln-rest API with a scoped rune (invoice-only, cannot move funds).
// CLN_API_URL must be set — LAN for testing, Cloudflare Tunnel URL for production.

interface ClnConfig {
  apiUrl: string;
  rune: string;
}

interface Invoice {
  bolt11: string;
  payment_hash: string;
  expires_at: number;
  label: string;
  amount_msat: number;
  description: string;
}

interface InvoiceStatus {
  label: string;
  status: 'unpaid' | 'paid' | 'expired';
  payment_hash: string;
  amount_msat: number;
  // What actually ARRIVED (set once paid). The authoritative amount for an AMOUNTLESS invoice,
  // where the payer chose the amount in their own wallet (Ant 2026-07-10).
  amount_received_msat?: number;
  paid_at?: number;
  pay_index?: number;
}

// ── BTC Price Conversion ──

let cachedRate: { rate: number; fetchedAt: number } | null = null;
const RATE_CACHE_MS = 30_000;

async function fetchBtcUsdRate(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < RATE_CACHE_MS) {
    return cachedRate.rate;
  }

  const sources = [
    async () => {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      const d = await r.json() as any;
      return d.bitcoin?.usd;
    },
    async () => {
      const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
      const d = await r.json() as any;
      return parseFloat(d.result?.XXBTZUSD?.c?.[0]);
    },
    async () => {
      const r = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
      const d = await r.json() as any;
      return parseFloat(d.data?.amount);
    },
  ];

  for (const source of sources) {
    try {
      const rate = await source();
      if (rate && rate > 0) {
        cachedRate = { rate, fetchedAt: Date.now() };
        return rate;
      }
    } catch {}
  }

  throw new Error('All BTC price sources failed');
}

// Sanity-bound a fetched fiat rate before it's used to size an invoice or credit a wallet (Codex
// 2026-07-10): a garbage/compromised price source is a credit-minting boundary. Throws so callers
// fail closed rather than mint at an absurd rate.
export function assertSaneBtcRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 1_000 || rate > 100_000_000) throw new Error(`BTC rate out of range: ${rate}`);
  return rate;
}
export function assertSaneSolRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 1 || rate > 100_000) throw new Error(`SOL rate out of range: ${rate}`);
  return rate;
}

export function usdToMsat(usd: number, btcUsdRate: number): number {
  return Math.round((usd / assertSaneBtcRate(btcUsdRate)) * 100_000_000 * 1000);
}

export function msatToSats(msat: number): number {
  return Math.round(msat / 1000);
}

// ── SOL price (mirror of the BTC rate fetch, its own cache) — for the Solana top-up rail. ──
let cachedSolRate: { rate: number; fetchedAt: number } | null = null;
export async function fetchSolUsdRate(): Promise<number> {
  if (cachedSolRate && Date.now() - cachedSolRate.fetchedAt < RATE_CACHE_MS) return cachedSolRate.rate;
  const sources = [
    async () => { const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'); const d = await r.json() as any; return d.solana?.usd; },
    async () => { const r = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot'); const d = await r.json() as any; return parseFloat(d.data?.amount); },
    async () => { const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=SOLUSD'); const d = await r.json() as any; return parseFloat(d.result?.SOLUSD?.c?.[0]); },
  ];
  for (const source of sources) {
    try { const rate = await source(); if (rate && rate > 0) { cachedSolRate = { rate, fetchedAt: Date.now() }; return rate; } } catch {}
  }
  throw new Error('All SOL price sources failed');
}

// USD → lamports at the given SOL/USD rate (1 SOL = 1e9 lamports).
export function usdToLamports(usd: number, solUsdRate: number): number {
  return Math.round((usd / assertSaneSolRate(solUsdRate)) * 1_000_000_000);
}

export { fetchBtcUsdRate };


// ── CLN API Calls ──

// A CLN call that couldn't reach the node (tunnel 530, connection refused, DNS, or timeout) — as
// opposed to a call the node answered with a real error. Callers use this to fail SOFT: an
// unreachable node must NEVER be scored as "the agent didn't pay" (that penalises the agent for OUR
// outage). instanceof ClnUnreachableError => infrastructure_unavailable, not a payment failure.
export class ClnUnreachableError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ClnUnreachableError'; }
}

const CLN_TIMEOUT_MS = 6000; // short — a wedged origin must not hang the Worker to the platform limit

async function clnRequest(config: ClnConfig, path: string, body?: any): Promise<any> {
  const url = `${config.apiUrl}${path}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLN_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.rune}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
  } catch (err: any) {
    // fetch threw = we never got a response: timeout/abort, connection refused, DNS. UNREACHABLE.
    throw new ClnUnreachableError(`CLN unreachable at ${path}: ${err?.name === 'AbortError' ? 'timeout' : err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // CF tunnel 530 (origin down) / 502 / 503 / 504 = the node is unreachable, not a node-level error.
    if ([502, 503, 504, 521, 522, 523, 524, 530].includes(response.status)) {
      throw new ClnUnreachableError(`CLN unreachable at ${path}: HTTP ${response.status}`);
    }
    throw new Error(`CLN API ${path} returned ${response.status}: ${text}`);
  }
  return response.json();
}

// Cached node-health probe (cheap getinfo). Cached ~45s so a run-gate / maintenance check on every
// request doesn't hammer the node. Returns true only if getinfo answered with a node id.
let cachedHealth: { ok: boolean; at: number } | null = null;
const HEALTH_CACHE_MS = 45_000;

export async function checkNodeHealth(config: ClnConfig, opts?: { force?: boolean }): Promise<boolean> {
  if (!opts?.force && cachedHealth && Date.now() - cachedHealth.at < HEALTH_CACHE_MS) {
    return cachedHealth.ok;
  }
  let ok = false;
  try {
    const info = await clnRequest(config, '/v1/getinfo');
    ok = !!info.id;
  } catch {
    ok = false;
  }
  cachedHealth = { ok, at: Date.now() };
  return ok;
}

export async function createInvoice(
  config: ClnConfig,
  opts: {
    amountMsat: number;
    label: string;
    description: string;
    expiry?: number;
  }
): Promise<Invoice> {
  // CLN's bolt11 invoice rejects non-ASCII in the description ("should be a string without \u").
  // Sanitise to printable ASCII so an em-dash/emoji in any caller's description can't break payments.
  const description = (opts.description || '').replace(/[^\x20-\x7E]/g, '-');
  const result = await clnRequest(config, '/v1/invoice', {
    amount_msat: opts.amountMsat,
    label: opts.label,
    description,
    expiry: opts.expiry ?? 600,
  });

  return {
    bolt11: result.bolt11,
    payment_hash: result.payment_hash,
    expires_at: result.expires_at,
    label: opts.label,
    amount_msat: opts.amountMsat,
    description,
  };
}

export async function checkInvoiceStatus(
  config: ClnConfig,
  label: string
): Promise<InvoiceStatus> {
  const result = await clnRequest(config, '/v1/listinvoices', { label });
  const inv = result.invoices?.[0];

  if (!inv) throw new Error(`Invoice not found: ${label}`);

  return {
    label: inv.label,
    status: inv.status,
    payment_hash: inv.payment_hash,
    amount_msat: inv.amount_msat ?? inv.msatoshi,
    amount_received_msat: inv.amount_received_msat ?? inv.msatoshi_received,
    paid_at: inv.paid_at,
    pay_index: inv.pay_index,
  };
}

export async function waitForPayment(
  config: ClnConfig,
  label: string
): Promise<InvoiceStatus> {
  const result = await clnRequest(config, '/v1/waitinvoice', { label });

  return {
    label: result.label,
    status: result.status,
    payment_hash: result.payment_hash,
    amount_msat: result.amount_msat ?? result.msatoshi,
    paid_at: result.paid_at,
    pay_index: result.pay_index,
  };
}


// ── Verigent-specific helpers ──

export function generateInvoiceLabel(purpose: string, id: string): string {
  return `verigent-${purpose}-${id}-${Date.now()}`;
}

export async function createVerigentInvoice(
  config: ClnConfig,
  opts: {
    purpose: 'benchmark' | 'sovereignty-proof';
    referenceId: string;
    amountUsd?: number;
    amountMsat?: number;
    description: string;
    expiry?: number;
  }
): Promise<{
  invoice: Invoice;
  btcUsdRate: number;
  amountSats: number;
  amountUsd: number;
}> {
  let amountMsat = opts.amountMsat ?? 0;
  let btcUsdRate = 0;
  let amountUsd = opts.amountUsd ?? 0;

  if (!amountMsat && amountUsd > 0) {
    btcUsdRate = await fetchBtcUsdRate();
    amountMsat = usdToMsat(amountUsd, btcUsdRate);
  } else if (amountMsat > 0) {
    btcUsdRate = await fetchBtcUsdRate();
    amountUsd = (amountMsat / 1000 / 100_000_000) * btcUsdRate;
  }

  const label = generateInvoiceLabel(opts.purpose, opts.referenceId);
  const invoice = await createInvoice(config, {
    amountMsat,
    label,
    description: opts.description,
    expiry: opts.expiry ?? 600,
  });

  return {
    invoice,
    btcUsdRate,
    amountSats: msatToSats(amountMsat),
    amountUsd,
  };
}

// Create a sovereignty proof invoice (tiny amount, just proving capability)
export async function createSovereigntyInvoice(
  config: ClnConfig,
  runToken: string,
  paymentRef: string,
): Promise<{
  invoice: Invoice;
  amountSats: number;
}> {
  const amountMsat = 100_000; // 100 sats = minimum sovereignty proof
  const label = generateInvoiceLabel('sov', `${runToken.slice(3, 11)}-${paymentRef}`);

  const invoice = await createInvoice(config, {
    amountMsat,
    label,
    description: `Verigent sovereignty proof: ${paymentRef}`,
    expiry: 1800, // 30 minutes for sovereignty proof (agent needs time)
  });

  return { invoice, amountSats: 100 };
}

// Verify a sovereignty payment was made
export async function verifySovereigntyPayment(
  config: ClnConfig,
  runToken: string,
  paymentRef: string,
): Promise<{
  paid: boolean;
  unavailable?: boolean; // node unreachable — do NOT score as a payment failure
  paymentHash?: string;
  paidAt?: number;
}> {
  try {
    // Search for invoices with our sovereignty prefix
    const result = await clnRequest(config, '/v1/listinvoices', {});
    const invoices = result.invoices || [];

    const match = invoices.find((inv: any) =>
      inv.label.startsWith('verigent-sov-') &&
      inv.label.includes(runToken.slice(3, 11)) &&
      inv.description?.includes(paymentRef) &&
      inv.status === 'paid'
    );

    if (match) {
      return { paid: true, paymentHash: match.payment_hash, paidAt: match.paid_at };
    }

    return { paid: false };
  } catch (err) {
    // CRITICAL fail-soft (2026-07-04 incident): if OUR node is unreachable we CANNOT know whether the
    // agent paid — returning {paid:false} would penalise the agent for our outage. Signal unavailable
    // so the grader marks the dimension "infrastructure unavailable — not scored", never zero.
    if (err instanceof ClnUnreachableError) return { paid: false, unavailable: true };
    return { paid: false };
  }
}
