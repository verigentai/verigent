"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe, type Appearance } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { PayTrust } from "./pay-marks";
import { FOUNDER_DAILY_CENTS, daysOfVerification, LIGHTNING_DISCOUNT, SOL_DISCOUNT } from "@/lib/pricing";

// DARK card top-up in the owner drawer, via Stripe ELEMENTS / PaymentElement (Ant 2026-07-04). Replaces
// the embedded-Checkout billing mode: embedded Checkout forces a tall white mobile-style form we can't
// compact or darken. Elements is compact + fully themeable, so this RETIRES the white "billing mode" and
// its dark-only exception — the payment surface is dark, on-brand, and fits a fixed-size drawer.
//
// Flow: pick amount → POST /api/wallet/create-payment-intent → client_secret → <Elements> + <PaymentElement>
// (dark appearance) → stripe.confirmPayment({elements, redirect:'if_required'}) → poll /api/wallet/balance
// until the WEBHOOK (payment_intent.succeeded) credits → inline success. Backend credit path UNCHANGED
// (webhook via metadata). Card-save is dropped (no setup_future_usage / customer) — auto-topup dormant.

let stripePromise: Promise<Stripe | null> | null = null;
async function getStripe(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise;
  stripePromise = (async () => {
    try {
      const r = await fetch("/api/wallet/stripe-pk", { headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!d?.publishable_key) return null;
      return await loadStripe(d.publishable_key);
    } catch { return null; }
  })();
  return stripePromise;
}

// DARK Elements appearance — maps to our palette (#2a2b37 bg / --violet #b9a8ee accent / our fonts).
// Reaches inside the Element iframe where our own CSS can't; 'night' is the dark base we then tune.
const APPEARANCE: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: "#b9a8ee",
    colorBackground: "#22232e",
    colorText: "#e9e8f2",
    colorTextSecondary: "#a6a4b8",
    colorDanger: "#ff7a7a",
    fontFamily: "var(--font-body), system-ui, sans-serif",
    borderRadius: "10px",
    spacingUnit: "4px",
    fontSizeBase: "14px",
  },
  rules: {
    ".Input": { backgroundColor: "#1f202b", border: "1px solid rgba(255,255,255,.12)", boxShadow: "none" },
    ".Input:focus": { border: "1px solid #b9a8ee", boxShadow: "0 0 0 1px #b9a8ee" },
    ".Label": { color: "#a6a4b8", fontWeight: "500" },
    ".Tab, .Block": { backgroundColor: "#1f202b", border: "1px solid rgba(255,255,255,.10)" },
    ".Tab:hover": { color: "#e9e8f2" },
    ".Tab--selected": { borderColor: "#b9a8ee", boxShadow: "0 0 0 1px #b9a8ee" },
  },
};

// meta ("~N days") DERIVED from the founding rate — never hand-typed (§2.10). Change the rate in
// functions/lib/pricing.ts and every preset's day-count updates.
const PLANS: { id: string; usd: number; label: string; meta: string }[] = [
  { id: "w10", usd: 10, label: "$10" },
  { id: "w25", usd: 25, label: "$25" },
  { id: "w50", usd: 50, label: "$50" },
].map((p) => ({ ...p, meta: `~${daysOfVerification(p.usd * 100, FOUNDER_DAILY_CENTS)} days` }));

type Pay =
  | { kind: "pick" }
  | { kind: "starting" }
  | { kind: "form"; clientSecret: string }       // Elements mounted
  | { kind: "crediting" }                          // paid; polling balance
  // save-card opt-in: credited AND auto-topup just flipped ON — show the plain-language confirm
  | { kind: "autotopup-on"; balanceUsd: string; last4: string | null; thresholdUsd: number; amountUsd: number }
  | { kind: "error"; message: string };

// The Elements-context inner form: PaymentElement + confirm. Lives inside <Elements> so it can call
// useStripe/useElements. On success (redirect:'if_required' → cards resolve inline) it hands back up.
// saveCard/onToggleSaveCard: the save-card OPT-IN (Ant 2026-07-13) — unticked, the payment is the
// exact minimal stripped form (no customer, no mandate); ticking recreates the PaymentIntent with
// setup_future_usage so Stripe's own consent text appears as the visible consequence of the tick.
function ElementsForm({ amountUsd, email, saveCard, onToggleSaveCard, onPaid, onBack }: {
  amountUsd: number; email: string | null; saveCard: boolean; onToggleSaveCard: (v: boolean) => void;
  onPaid: () => void; onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true); setErr("");
    try {
      // We hide the email field (fields.billingDetails.email='never') when the owner email is known, so
      // Stripe REQUIRES it in confirmParams here — omitting it made confirmPayment REJECT (throw), which
      // left the button stuck on "Processing…" and the PaymentIntent at requires_payment_method (never
      // charged). Pass the email through so the confirm actually goes.
      const confirmParams = email ? { payment_method_data: { billing_details: { email } } } : undefined;
      const { error } = await stripe.confirmPayment({
        elements,
        ...(confirmParams ? { confirmParams } : {}),
        redirect: "if_required",
      });
      if (error) {
        // Card declined / validation — stay on the form so they can fix it.
        setErr(error.message || "Payment failed — check your card details and try again.");
        setSubmitting(false);
        return;
      }
      // No redirect for cards → the PaymentIntent succeeded. The webhook credits async; poll upstream.
      onPaid();
    } catch (err: any) {
      // NEVER hang: any confirm rejection (misconfig, network) surfaces here and re-enables the button
      // instead of leaving "Processing…" forever.
      setErr(err?.message || "Payment couldn't be completed — please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className="pe-form" onSubmit={submit}>
      <PaymentElement options={{
        layout: "tabs",
        defaultValues: email ? { billingDetails: { email } } : undefined,
        fields: { billingDetails: { email: email ? "never" : "auto" } },
      }} />
      <label className="pe-save">
        <input type="checkbox" checked={saveCard} disabled={submitting}
          onChange={(e) => onToggleSaveCard(e.target.checked)} />
        <span>
          <b>Keep this card for automatic top-ups</b>
          <em>When this agent&apos;s wallet runs low, we top it up automatically. The daily rate is always shown on your report. Change or remove any time.</em>
        </span>
      </label>
      {err && <div className="pe-err">{err}</div>}
      <button className="billing-pay" type="submit" disabled={!stripe || submitting}>
        {submitting ? "Processing…" : `Pay $${amountUsd} by card`}
      </button>
      <button className="pe-back" type="button" onClick={onBack} disabled={submitting}>Choose a different amount</button>
    </form>
  );
}

// onDone(newBalanceUsd) fires when the webhook credits.
export function CardTopupBilling({ handle, onCancel, onDone }: {
  handle: string;
  onCancel: () => void;
  onDone: (newBalanceUsd: string) => void;
}) {
  const [plan, setPlan] = useState("w10");
  const [custom, setCustom] = useState("");
  const [pay, setPay] = useState<Pay>({ kind: "pick" });
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [saveCard, setSaveCard] = useState(false);
  const piIdRef = useRef<string | null>(null);   // the PI we're paying — the confirm-autotopup capability
  const aliveRef = useRef(true);
  const baselineRef = useRef(-1); // pre-payment balance snapshot (cents); -1 = not captured
  useEffect(() => () => { aliveRef.current = false; }, []);
  // Reuse of the (loved) embedded-form open animation: a ResizeObserver writes the inner Element's real
  // height onto a `transition: height` wrapper, so the reveal AND the PaymentElement's async self-size
  // ease into ONE continuous motion — no snap, no double-jump — WITHIN the fixed-size drawer.
  const peWrapRef = useRef<HTMLDivElement | null>(null);
  const peInnerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (pay.kind !== "form") return;
    const wrap = peWrapRef.current, inner = peInnerRef.current;
    if (!wrap || !inner) return;
    const ro = new ResizeObserver(() => { wrap.style.height = inner.offsetHeight + "px"; });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [pay.kind]);

  function amountUsd(): number {
    if (plan === "custom") { const a = parseFloat(custom); return Number.isFinite(a) ? a : 0; }
    return PLANS.find((p) => p.id === plan)?.usd ?? 10;
  }

  async function payByCard(withSave: boolean = saveCard) {
    setPay({ kind: "starting" });
    // Snapshot the PRE-payment balance now: the webhook often credits before the first post-confirm
    // poll returns, and a post-credit baseline means "balance moved" never fires (review 5kk #5).
    fetch(`/api/wallet/balance?${new URLSearchParams({ handle })}`, { headers: { Accept: "application/json" } })
      .then((r) => r.json()).then((d) => {
        if (typeof d?.balance_cents === "number") baselineRef.current = d.balance_cents;
      }).catch(() => { /* baseline stays -1 → pollCredited falls back to first-poll capture */ });
    try {
      const s = await getStripe();
      if (!s) { setPay({ kind: "error", message: "Card payments are unavailable right now." }); return; }
      const res = await fetch("/api/wallet/create-payment-intent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // credentials → the owner cookie rides along (email prefill; save_card anchors to the owner)
        credentials: "include",
        body: JSON.stringify({ handle, amount_usd: amountUsd(), save_card: withSave }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.client_secret) {
        setPay({ kind: "error", message: d?.error || "Payment setup failed — try again." });
        return;
      }
      if (!aliveRef.current) return;
      piIdRef.current = d.payment_intent_id ?? null;
      setStripe(s);
      setOwnerEmail(d.owner_email ?? null);
      setPay({ kind: "form", clientSecret: d.client_secret });
    } catch {
      setPay({ kind: "error", message: "Couldn't reach the payment service — try again." });
    }
  }

  // After confirmPayment succeeds: the webhook credits async, so poll balance until it moves past the
  // PRE-payment baseline (captured in payByCard — a post-confirm baseline usually already contains the
  // credit on fast webhooks, which made every quick payment look stalled; review 5kk #5).
  async function pollCredited() {
    setPay({ kind: "crediting" });
    const q = new URLSearchParams({ handle }).toString();
    let baseline = baselineRef.current;
    let lastSeen: number | null = null;
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch(`/api/wallet/balance?${q}`, { headers: { Accept: "application/json" } });
        const d = await r.json().catch(() => ({}));
        const cents = typeof d?.balance_cents === "number" ? d.balance_cents : null;
        if (cents != null) {
          lastSeen = cents;
          if (baseline < 0) baseline = cents; // pre-payment snapshot failed → old first-poll fallback
          if (cents > baseline) { await settle((cents / 100).toFixed(2)); return; }
        }
      } catch { /* transient */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Poll timed out (webhook lag). Hand back the freshest real balance we saw rather than nothing,
    // so the drawer never closes showing a stale pre-payment figure.
    await settle(lastSeen != null ? (lastSeen / 100).toFixed(2) : "");
  }

  // Credit landed. Plain top-up → straight out via onDone. Save-card opt-in → flip auto-topup ON
  // (confirm-autotopup verifies the PI against Stripe — the tick + the completed payment ARE the
  // consent) and show the plain-language confirmation before handing back. A confirm failure is
  // non-fatal: the card may still have been saved by the webhook; owner controls can enable later.
  async function settle(balanceUsd: string) {
    if (!saveCard || !piIdRef.current) { onDone(balanceUsd); return; }
    try {
      const r = await fetch("/api/wallet/confirm-autotopup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_intent_id: piIdRef.current }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.enabled) {
        setPay({
          kind: "autotopup-on", balanceUsd,
          last4: d.card_last4 ?? null,
          thresholdUsd: (d.threshold_cents ?? 500) / 100,
          amountUsd: (d.amount_cents ?? 1000) / 100,
        });
        return;
      }
    } catch { /* non-fatal — fall through */ }
    onDone(balanceUsd);
  }

  return (
    <div className="billing" role="region" aria-label="Card top-up">
      <div className="billing-body">
        <div className="billing-col">
          <div className="billing-colhead">
            <span className="billing-badge">Billing · secure card payment</span>
            <button className="billing-x" onClick={onCancel} aria-label="Cancel">← Back</button>
          </div>

          {pay.kind === "pick" && (
            <>
              <div className="billing-amounts">
                {PLANS.map((pl) => (
                  <button key={pl.id} className={`billing-amt${plan === pl.id ? " on" : ""}`} onClick={() => setPlan(pl.id)}>
                    <span className="ba-usd">{pl.label}</span><span className="ba-meta">{pl.meta}</span>
                  </button>
                ))}
                <label className={`billing-amt billing-custom${plan === "custom" ? " on" : ""}`}>
                  <span className="ba-usd"><span className="ba-dollar">$</span>
                    <input inputMode="decimal" placeholder="amt" value={custom}
                      onFocus={() => setPlan("custom")}
                      onChange={(e) => { setCustom(e.target.value.replace(/[^0-9.]/g, "")); setPlan("custom"); }} />
                  </span>
                  <span className="ba-meta">min $10</span>
                </label>
              </div>
              <button className="billing-pay" onClick={() => payByCard()} disabled={amountUsd() < 10}>
                Continue to card →
              </button>
              <p className="billing-note">Charged to your card. Credit lands the moment payment clears.</p>
              <PayTrust />
            </>
          )}

          {pay.kind === "starting" && <div className="billing-status">Setting up secure payment…</div>}

          {pay.kind === "form" && stripe && (
            <div className="pe-wrap" ref={peWrapRef}>
              <div ref={peInnerRef}>
                <Elements key={pay.clientSecret} stripe={stripe} options={{ clientSecret: pay.clientSecret, appearance: APPEARANCE }}>
                  <ElementsForm amountUsd={amountUsd()} email={ownerEmail}
                    saveCard={saveCard}
                    // The opt-in changes the PaymentIntent itself (customer + setup_future_usage), so a
                    // toggle recreates it — brief "setting up" flicker, then the form returns with
                    // Stripe's consent line present/absent to match the tick.
                    onToggleSaveCard={(v) => { setSaveCard(v); void payByCard(v); }}
                    onPaid={pollCredited} onBack={() => setPay({ kind: "pick" })} />
                </Elements>
              </div>
            </div>
          )}

          {pay.kind === "crediting" && <div className="billing-status">Payment received — crediting your wallet…</div>}

          {pay.kind === "autotopup-on" && (
            <div className="at-on" role="status">
              <div className="at-on-h">✓ Paid — and auto top-up is ON</div>
              <p>
                When <b>{handle}</b>&apos;s wallet drops below <b>${pay.thresholdUsd.toFixed(2)}</b> we&apos;ll
                top it up with <b>${pay.amountUsd.toFixed(2)}</b>{pay.last4 ? <> charged to <b>····{pay.last4}</b></> : null}.
                The daily rate is always shown on your report. Change the amounts or remove the card any
                time in your owner controls.
              </p>
              <button className="billing-pay" onClick={() => onDone(pay.balanceUsd)}>Done</button>
            </div>
          )}
          {pay.kind === "error" && (
            <div className="billing-err">
              {pay.message} <button className="billing-retry" onClick={() => setPay({ kind: "pick" })}>Try again</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared crypto-rail helpers ─────────────────────────────────────────────────
// Live BTC/SOL rates for the unit-of-account displays (Ant 2026-07-10): everything shown in the
// payer's unit (sats / SOL) derives from these at render time — the 30s-cached multi-source rate,
// never a hand-pinned figure.
function useRates() {
  const [rates, setRates] = useState<{ btc_usd: number | null; sol_usd: number | null }>({ btc_usd: null, sol_usd: null });
  useEffect(() => {
    let stop = false;
    fetch("/api/wallet/rates", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && !stop) setRates({ btc_usd: j.btc_usd ?? null, sol_usd: j.sol_usd ?? null }); })
      .catch(() => {});
    return () => { stop = true; };
  }, []);
  return rates;
}

// ~days a USD amount buys AFTER the rail bonus — the caption under every crypto preset.
const daysFor = (usd: number, bonus: number) => daysOfVerification(Math.round(usd * 100 * (1 + bonus)), FOUNDER_DAILY_CENTS);

const CopyIcon = ({ done }: { done: boolean }) => done
  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;

// The confirm affordance both crypto rails share (Ant 2026-07-10): "Confirm payment →" that flips
// ITSELF to "✓ Payment received" when the money lands (auto-poll or manual click — same button).
function ConfirmButton({ state, onClick }: { state: "idle" | "checking" | "paid"; onClick: () => void }) {
  return (
    <button className={`billing-pay${state === "paid" ? " pay-received" : ""}`} onClick={onClick} disabled={state !== "idle"}>
      {state === "paid" ? "✓ Payment received" : state === "checking" ? "Checking…" : "I've sent it — check now"}
    </button>
  );
}

// ── LIGHTNING top-up (Ant 2026-07-10, v5 — one page, no amount picking) ────────
// You pay from YOUR OWN wallet, so there's nothing to "pick" here (no central party executes for
// you). One page: the floating minimum in sats, a STATIC unit-of-account reference (what $10/$25/$50
// buys in sats and ~days — informational, not clickable), the amountless invoice to copy, and a
// Confirm button that flips itself to "✓ Payment received" (auto-poll 2.5s).
function LightningTopup({ handle, onCancel, onDone }: {
  handle: string; onCancel: () => void; onDone: (usd: string) => void;
}) {
  const { btc_usd } = useRates();
  const [inv, setInv] = useState<{ bolt11: string; pollUrl: string } | null>(null);
  const [selSats, setSelSats] = useState<number | null>(null);
  const [customSats, setCustomSats] = useState("");
  const [phase, setPhase] = useState<"idle" | "minting" | "waiting" | "checking" | "paid">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const doneRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const satsFor = (usd: number) => btc_usd ? Math.round(usd / btc_usd * 100_000_000) : null;

  // FIXED-amount invoices only (Ant hit it live, 2026-07-10): Coinbase — the mainstream on-ramp —
  // refuses amountless bolt11 ("only supports Lightning invoices with a fixed payment amount"), so
  // the amount is chosen HERE and baked into the invoice. This is the one honest difference from
  // Sol: a Lightning invoice IS the payment request; there is no static address to just send to.
  async function mint(sats: number) {
    setSelSats(sats); setErr(null); setInv(null); setPhase("minting");
    try {
      const res = await fetch("/api/wallet/topup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, amount_sats: sats, method: "lightning" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.bolt11 || !d.poll_url) {
        setErr(d?.error || "Couldn't create a Lightning invoice — try again, or use a card.");
        return;
      }
      if (!aliveRef.current) return;
      setInv({ bolt11: d.bolt11, pollUrl: d.poll_url });
      setPhase("waiting");
    } catch { setErr("Couldn't reach the payment service — try again."); }
  }

  const settle = (balanceUsd: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("paid");
    setTimeout(() => onDone(balanceUsd), 1400);
  };
  async function checkOnce(manual = false) {
    if (!inv || doneRef.current) return;
    if (manual) setPhase("checking");
    try {
      const r = await fetch(inv.pollUrl, { headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (d?.status === "paid" || d?.paid === true) { settle(""); return; }
    } catch { /* transient */ }
    if (manual && !doneRef.current) setPhase("waiting");
  }
  useEffect(() => {
    if (!inv) return;
    let stop = false; let n = 0;
    const tick = async () => {
      if (stop || doneRef.current) return;
      await checkOnce(false);
      n++;
      if (n < 120 && !stop && !doneRef.current) t = setTimeout(tick, 2500);
    };
    let t = setTimeout(tick, 2500);
    return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv]);


  return (
    <div className="billing billing-crypto" role="region" aria-label="Lightning top-up">
      <div className="billing-body">
        <div className="billing-col">
          <div className="billing-colhead">
            <span className="billing-badge">Bitcoin · Lightning · +{Math.round(LIGHTNING_DISCOUNT * 100)}% credit</span>
            <button className="billing-x" onClick={onCancel} aria-label="Back">← Back</button>
          </div>

          {/* SELECTABLE on Lightning (unlike Sol's info chips): the amount must live IN the invoice —
              Coinbase refuses amountless bolt11. Same chips, same units, picking one mints it. */}
          <div className="billing-amounts">
            {[10, 25, 50].map((usd) => {
              const sats = satsFor(usd);
              return (
                <button key={usd} className={`billing-amt${sats != null && selSats === sats ? " on" : ""}`} disabled={sats == null}
                  onClick={() => sats != null && mint(sats)}>
                  <span className="ba-usd ba-crypto">{sats != null ? sats.toLocaleString() : "…"}<i>sats</i></span>
                  <span className="ba-meta">~{daysFor(usd, LIGHTNING_DISCOUNT)} days · ≈ ${usd}</span>
                </button>
              );
            })}
            <label className={`billing-amt billing-custom${customSats && selSats === Math.round(parseFloat(customSats) || 0) ? " on" : ""}`}>
              <span className="ba-usd">
                <input inputMode="numeric" placeholder="sats" value={customSats}
                  onChange={(e) => setCustomSats(e.target.value.replace(/[^0-9]/g, ""))}
                  onKeyDown={(e) => { const v = Math.round(parseFloat(customSats) || 0); if (e.key === "Enter" && v > 0) mint(v); }} />
              </span>
              <span className="ba-meta">
                {btc_usd && customSats && (parseFloat(customSats) || 0) > 0
                  ? `≈ $${(((parseFloat(customSats) || 0) / 100_000_000) * btc_usd).toFixed(2)} — Enter ↵`
                  : "any amount"}
              </span>
            </label>
          </div>

          <div className="crypto-perday">
            {btc_usd
              ? <>Continuous verification runs ≈ <b>{Math.round(FOUNDER_DAILY_CENTS / 100 / btc_usd * 100_000_000).toLocaleString()} sats/day</b> (≈ ${(FOUNDER_DAILY_CENTS / 100).toFixed(2)}/day)</>
              : null}
          </div>

          {phase === "minting" && <div className="billing-status">Minting your Lightning invoice…</div>}
          {err && (
            <div className="billing-err">
              {err} <button className="billing-retry" onClick={() => { const v = selSats ?? (btc_usd ? Math.round(10 / btc_usd * 100_000_000) : null); if (v) mint(v); }}>Try again</button>
            </div>
          )}

          {inv && (
            <div className="ln-invoice">
              <div className="sol-field">
                <span className="sol-flabel">Pay this invoice — {selSats != null ? `${selSats.toLocaleString()} sats` : ""}</span>
                <div className="sol-bar">
                  <code className="ln-bolt11">{inv.bolt11}</code>
                  <button className="sol-copy" onClick={() => { navigator.clipboard?.writeText(inv.bolt11); setCopied(true); setTimeout(() => setCopied(false), 1500); }} aria-label="Copy invoice" title="Copy invoice">
                    <CopyIcon done={copied} />
                  </button>
                </div>
              </div>
              {phase !== "paid" && <div className="ln-wait"><span className="ln-spin" /> Watching for your payment — credits the moment it clears. Invoice valid 10 min.</div>}
              <ConfirmButton state={phase === "paid" ? "paid" : phase === "checking" ? "checking" : "idle"} onClick={() => checkOnce(true)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SOLANA top-up (Ant 2026-07-10, v5 — one page, no amount picking) ───────────
// Same shape as Lightning: floating minimum in SOL, static unit-of-account reference, then the
// address + memo (= agent handle). The chain-watch (6s) credits whatever lands; the Confirm button
// flips itself to "✓ Payment received".
function SolTopup({ handle, onCancel, onDone }: {
  handle: string; onCancel: () => void; onDone: (usd: string) => void;
}) {
  const { sol_usd } = useRates();
  const [copied, setCopied] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "paid">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [txidIn, setTxidIn] = useState("");
  const [pending, setPending] = useState(false);
  const [info, setInfo] = useState<{ address: string; memo: string } | null>(null);
  const doneRef = useRef(false);

  const copy = (val: string, key: string) => { navigator.clipboard?.writeText(val); setCopied(key); setTimeout(() => setCopied(null), 1500); };

  const settle = (balanceUsd: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("paid");
    setTimeout(() => onDone(balanceUsd), 1400);
  };
  const scan = async (manual = false) => {
    if (doneRef.current) return;
    if (manual) { setPhase("checking"); setNote(null); }
    try {
      const t = txidIn.trim();
      const res = await fetch("/api/wallet/scan-sol-topup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // credentials → the owner cookie rides along: a memo-less txid claim is owner-gated server-side
        // (theft guard), and the drawer is already a signed-in surface.
        credentials: "include",
        // A pasted transaction hash rides along on MANUAL checks only — the fallback for exchanges
        // (Coinbase shows a "Note" field but never writes it on-chain, Ant discovered live 2026-07-10).
        body: JSON.stringify(manual && t ? { handle, txid: t } : { handle }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { if (manual) setNote(d?.error || "Couldn't check the chain — try again."); return; }
      if (d.address && d.memo) setInfo({ address: d.address, memo: d.memo });
      if ((d.credited_cents ?? 0) > 0) { settle(d.balance_usd || ""); return; }
      // Memo-less pasted payment → queued for manual review, NOT instant (theft guard). Tell them
      // plainly it'll take a few hours BECAUSE no memo was attached.
      if (d.pending_review) {
        setPending(true);
        if (manual) setNote(null);
        return;
      }
      if (manual) setNote("No new payment found yet — settlement usually lands within a minute of sending.");
    } catch {
      if (manual) setNote("Couldn't reach the payment service — try again.");
    } finally {
      if (manual && !doneRef.current) setPhase("idle");
    }
  };
  useEffect(() => {
    let stop = false;
    const tick = async () => { if (!stop) { await scan(false); if (!stop && !doneRef.current) t = setTimeout(tick, 6000); } };
    let t = setTimeout(tick, 0);
    return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const solFor = (usd: number) => sol_usd ? usd / sol_usd : null;

  return (
    <div className="billing billing-crypto" role="region" aria-label="Solana top-up">
      <div className="billing-body">
        <div className="billing-col">
          <div className="billing-colhead">
            <span className="billing-badge">Solana · +{Math.round(SOL_DISCOUNT * 100)}% credit</span>
            <button className="billing-x" onClick={onCancel} aria-label="Back">← Back</button>
          </div>

          {/* STATIC unit-of-account reference — informational only, not clickable. */}
          <div className="billing-amounts ba-static-row">
            {[10, 25, 50].map((usd) => {
              const s = solFor(usd);
              return (
                <div key={usd} className="billing-amt ba-static" aria-hidden>
                  <span className="ba-usd ba-crypto">{s != null ? s.toFixed(4) : "…"}<i>SOL</i></span>
                  <span className="ba-meta">~{daysFor(usd, SOL_DISCOUNT)} days · ≈ ${usd}</span>
                </div>
              );
            })}
          </div>

          <div className="crypto-perday">
            {sol_usd
              ? <>Continuous verification runs ≈ <b>{(FOUNDER_DAILY_CENTS / 100 / sol_usd).toFixed(5)} SOL/day</b> (≈ ${(FOUNDER_DAILY_CENTS / 100).toFixed(2)}/day)</>
              : null}
          </div>

          {pending ? (
            // Memo-less payment queued for manual review (Ant ruling 2026-07-10): plainly state the
            // few-hours wait AND why — no memo means we can't auto-attribute it.
            <div className="ln-invoice">
              <div className="sol-pending">
                <div className="sol-pending-h">✓ Payment received — pending review</div>
                <p>Your transaction was sent <b>without a memo</b>, so we can&apos;t automatically match it to your agent. We&apos;ll verify it by hand and credit your wallet — <b>usually within a few hours</b>.</p>
                <p className="sol-pending-tip">Next time, send from a wallet that lets you add a memo (your agent handle) and crediting is <b>instant</b>. Exchanges like Coinbase don&apos;t attach memos — that&apos;s what causes the wait.</p>
              </div>
            </div>
          ) : (
          <div className="ln-invoice">
            <div className="sol-field">
              <span className="sol-flabel">Send SOL to this address</span>
              <div className="sol-bar">
                <code className="ln-bolt11">{info?.address || "…"}</code>
                {info && (
                  <button className="sol-copy" onClick={() => copy(info.address, "addr")} aria-label="Copy address" title="Copy address">
                    <CopyIcon done={copied === "addr"} />
                  </button>
                )}
              </div>
            </div>
            {/* Memo = INSTANT (proves attribution); no memo = a few hours' manual review. Stated so the
                trade-off is the payer's informed choice (Ant 2026-07-10). */}
            <div className="crypto-amt-eq">
              Add <b>{info?.memo || handle}</b> as the memo → credited <b>instantly</b>. No memo (most exchanges, incl. Coinbase) → we credit it by hand, <b>usually within a few hours</b>.
            </div>
            <div className="sol-field">
              <span className="sol-flabel">After sending, paste your transaction hash (from your wallet&apos;s receipt)</span>
              <div className="sol-bar">
                <input className="sol-txid" placeholder="transaction hash (from your receipt)" value={txidIn} onChange={(e) => setTxidIn(e.target.value.trim())} />
              </div>
            </div>
            {phase !== "paid" && <div className="ln-wait"><span className="ln-spin" /> Watching the chain — a memo&apos;d payment credits automatically when it lands.</div>}
            {note && <div className="sol-note">{note}</div>}
            <ConfirmButton state={phase} onClick={() => scan(true)} />
          </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── THREE-RAIL selector (Ant 2026-07-10) ───────────────────────────────────────
// The advertised entry: choose Bitcoin/Lightning, Solana, or Card. Fiat + Lightning are live; Sol is
// gated ("landing this week") until its receive/confirm backend ships — never a fake card that routes
// to Stripe. Discount badges derive from pricing.ts (LN +12% / SOL +8%).
type Rail = null | "fiat" | "lightning" | "sol";
export function TopupRails({ handle, onCancel, onDone }: {
  handle: string; onCancel: () => void; onDone: (usd: string) => void;
}) {
  const [rail, setRail] = useState<Rail>(null);
  if (rail === "fiat") return <CardTopupBilling handle={handle} onCancel={() => setRail(null)} onDone={onDone} />;
  if (rail === "lightning") return <LightningTopup handle={handle} onCancel={() => setRail(null)} onDone={onDone} />;
  if (rail === "sol") return <SolTopup handle={handle} onCancel={() => setRail(null)} onDone={onDone} />;
  const pct = (f: number) => `+${Math.round(f * 100)}%`;
  return (
    <div className="billing" role="region" aria-label="Add credit">
      <div className="billing-body">
        <div className="billing-col">
          <div className="billing-colhead">
            <span className="billing-badge">Add credit · choose how to pay</span>
            <button className="billing-x" onClick={onCancel} aria-label="Cancel">← Back</button>
          </div>
          <div className="rail-cards">
            <button className="rail-card" onClick={() => setRail("lightning")}>
              <span className="rail-ic rail-btc">₿</span>
              <span className="rail-name">Bitcoin · Lightning</span>
              <span className="rail-bonus">{pct(LIGHTNING_DISCOUNT)} credit</span>
              <span className="rail-sub">Cheapest rail — instant, lowest fees</span>
            </button>
            <button className="rail-card" onClick={() => setRail("sol")}>
              <span className="rail-ic rail-sol">◎</span>
              <span className="rail-name">Solana</span>
              <span className="rail-bonus">{pct(SOL_DISCOUNT)} credit</span>
              <span className="rail-sub">On-chain — pay, paste your txid</span>
            </button>
            <button className="rail-card" onClick={() => setRail("fiat")}>
              <span className="rail-ic rail-fiat">◈</span>
              <span className="rail-name">Card</span>
              <span className="rail-bonus rail-bonus-none">standard rate</span>
              <span className="rail-sub">Visa · Mastercard · Amex</span>
            </button>
          </div>
          <p className="billing-note">Crypto rails carry a standing credit bonus — pay less for the same verification. Your prepaid balance never expires.</p>
        </div>
      </div>
    </div>
  );
}
