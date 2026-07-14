"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeEmbeddedCheckout } from "@stripe/stripe-js";
import { FOUNDER_DAILY_CENTS, DAILY_DEBIT_CENTS, daysOfVerification } from "@/lib/pricing";

// Stripe.js loaded once, keyed on the PUBLISHABLE key served from /api/wallet/stripe-pk (endpoint, not
// a build-baked NEXT_PUBLIC — a go-live key swap needs no rebuild). Cached across mounts.
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

// Port of mockups/keep-current.html. The TOP-UP flow is LIVE-WIRED to
// POST /api/wallet/topup (Stripe → redirect to checkout_url; Lightning → show
// the bolt11 invoice + poll /api/wallet/check-payment until paid; 503 → auto
// fall back to Stripe). The agent is identified by ?handle= / ?agent= in the URL
// (the API hard-requires handle|agent_id), or entered by hand if absent. The
// recall-code MANAGE block stays presentation-only — out of this wiring's scope.
// Fetches are same-origin (Cloudflare Pages Functions), matching /owner.

// Wallet top-up presets. No subscription/plans — each preset just credits that amount (sent as
// amount_usd to /api/wallet/topup); "custom" sends any amount. Day-runway is at the ~25¢/day rate.
// meta ("~N days of proof") DERIVED from the founding rate — never hand-typed (§2.10).
const PLANS: { id: string; usd: number; name: string; amt: string; meta: string; tag?: string }[] = [
  { id: "w10", usd: 10, name: "Starter wallet", amt: "$10", tag: "Start here" },
  { id: "w25", usd: 25, name: "Stocked wallet", amt: "$25" },
  { id: "w50", usd: 50, name: "Stacked wallet", amt: "$50" },
].map((p) => ({ ...p, meta: `~${daysOfVerification(p.usd * 100, FOUNDER_DAILY_CENTS)} days of proof` }));

type PayState =
  | { kind: "idle" }
  | { kind: "starting"; label: string }
  | { kind: "embedded" }                              // Stripe card form mounted inline on our page
  | { kind: "crediting" }                             // payment done; polling the wallet until credited
  | { kind: "credited"; creditedUsd: string; balanceUsd: string }
  | { kind: "invoice"; bolt11: string; sats: number; pollUrl: string; expiresAt: number }
  | { kind: "paid" }
  | { kind: "error"; message: string };

export function KeepCurrentView() {
  const [plan, setPlan] = useState<string>("w10");
  const [custom, setCustom] = useState("");
  const [pay, setPay] = useState<PayState>({ kind: "idle" });
  const embedRef = useRef<HTMLDivElement | null>(null);          // container the Stripe form mounts into
  const checkoutRef = useRef<StripeEmbeddedCheckout | null>(null); // the mounted instance (for teardown)
  const pendingSecretRef = useRef<string | null>(null);          // client_secret awaiting the mount effect
  const baselineRef = useRef(-1);                                // pre-payment balance snapshot (cents); -1 = not captured

  // The agent to credit. /api/wallet/topup needs handle|agent_id; we read it from
  // the URL (?handle= or ?agent=), and fall back to a hand-entered handle if absent.
  const [handle, setHandle] = useState<string>("");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const h = p.get("handle") || p.get("agent") || "";
    if (h) setHandle(h.trim());
  }, []);

  // Resolve the request body for /api/wallet/topup from the current plan selection.
  // A named plan fixes the price (planKey); "custom" sends amount_usd in dollars.
  function topupBody(method: "stripe" | "lightning" | "sol") {
    const base: Record<string, unknown> = { handle, method };
    if (plan === "custom") {
      const amt = parseFloat(custom);
      base.amount_usd = Number.isFinite(amt) ? amt : 0;
    } else {
      base.amount_usd = PLANS.find((p) => p.id === plan)?.usd ?? 10;
    }
    return base;
  }

  // method: "card"|"lightning"|"solana" (UI) → "stripe"|"lightning"|"sol" (API).
  async function onPay(method: "card" | "lightning" | "solana") {
    if (!handle.trim()) {
      setPay({ kind: "error", message: "Enter your agent's handle above so we know which wallet to top up." });
      return;
    }
    const apiMethod = method === "card" ? "stripe" : method === "solana" ? "sol" : "lightning";
    const label = { card: "card", lightning: "Lightning", solana: "Solana" }[method];
    setPay({ kind: "starting", label });
    // Snapshot the PRE-payment balance: the webhook often credits before the first post-payment poll,
    // and a post-payment baseline means "balance moved" never fires (review 5kk #5).
    fetch(`/api/wallet/balance?${new URLSearchParams({ handle })}`, { headers: { Accept: "application/json" } })
      .then((r) => r.json()).then((d) => {
        if (typeof d?.balance_cents === "number") baselineRef.current = d.balance_cents;
      }).catch(() => { /* baseline stays -1 → poll falls back to first-poll capture */ });
    try {
      const res = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(topupBody(apiMethod)),
      });
      const d = await res.json().catch(() => ({}));

      // Lightning rail down → the API hands back fallback:"stripe". Retry once on Stripe.
      if (res.status === 503 && d?.fallback === "stripe" && apiMethod !== "stripe") {
        return startStripe();
      }
      if (!res.ok) {
        setPay({ kind: "error", message: d?.error || "Payment setup failed — try again." });
        return;
      }

      if (d.method === "stripe" && d.client_secret) {
        await mountEmbedded(d.client_secret);
        return;
      }
      if (d.method === "lightning" && d.bolt11) {
        setPay({
          kind: "invoice",
          bolt11: d.bolt11,
          sats: d.amount_sats,
          pollUrl: d.poll_url,
          expiresAt: Date.now() + (d.expires_in_seconds || 600) * 1000,
        });
        return;
      }
      setPay({ kind: "error", message: "Unexpected response from the payment service." });
    } catch {
      setPay({ kind: "error", message: "Couldn't reach the payment service — try again." });
    }
  }

  // Direct Stripe start (also the Lightning-503 fallback target).
  async function startStripe() {
    setPay({ kind: "starting", label: "card" });
    try {
      const res = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(topupBody("stripe")),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.client_secret) {
        await mountEmbedded(d.client_secret);
        return;
      }
      setPay({ kind: "error", message: d?.error || "Payment setup failed — try again." });
    } catch {
      setPay({ kind: "error", message: "Couldn't reach the payment service — try again." });
    }
  }

  // Kick off EMBEDDED Checkout: stash the secret + flip to the "embedded" state so the container
  // renders. The ACTUAL Stripe mount happens in the effect below — that guarantees embedRef is
  // committed to the DOM first (a setTimeout(0) race here left the ref null and errored).
  async function mountEmbedded(clientSecret: string) {
    const stripe = await getStripe();
    if (!stripe) { setPay({ kind: "error", message: "Card payments are unavailable right now — try Lightning or Solana." }); return; }
    pendingSecretRef.current = clientSecret;
    setPay({ kind: "embedded" });
  }

  // Mount Stripe EMBEDDED Checkout inline once the container is in the DOM (pay.kind==="embedded" →
  // this effect runs AFTER the render commits, so embedRef.current is guaranteed present). On complete,
  // poll the wallet until the WEBHOOK credits (source of truth — we NEVER credit client-side).
  useEffect(() => {
    if (pay.kind !== "embedded") return;
    const secret = pendingSecretRef.current;
    if (!secret || !embedRef.current || checkoutRef.current) return;
    let cancelled = false;
    (async () => {
      const stripe = await getStripe();
      if (!stripe || cancelled || !embedRef.current) return;
      try {
        const checkout = await stripe.initEmbeddedCheckout({
          clientSecret: secret,
          onComplete: () => { void pollBalanceUntilCredited(); },
        });
        if (cancelled) { try { checkout.destroy(); } catch { /* ignore */ } return; }
        checkoutRef.current = checkout;
        checkout.mount(embedRef.current);
      } catch {
        setPay({ kind: "error", message: "Couldn't render the card form — try again." });
      }
    })();
    return () => { cancelled = true; };
  }, [pay.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // After Stripe onComplete: the webhook credits async, so poll GET /api/wallet/balance until it moves,
  // then show "$X credited · balance $Y" inline. The webhook is authoritative — this only READS balance.
  async function pollBalanceUntilCredited() {
    try { checkoutRef.current?.destroy(); } catch { /* ignore */ } // tear the form down; payment's done
    checkoutRef.current = null;
    setPay({ kind: "crediting" });
    const wanted = (() => { const b = topupBody("stripe"); return typeof b.amount_usd === "number" ? (b.amount_usd as number) : null; })();
    const q = new URLSearchParams({ handle }).toString();
    let baseline = baselineRef.current;                    // pre-payment snapshot (onPay); -1 = not captured
    for (let i = 0; i < 20; i++) {                       // ~30s of polling (webhook usually lands in <5s)
      try {
        const r = await fetch(`/api/wallet/balance?${q}`, { headers: { Accept: "application/json" } });
        const d = await r.json().catch(() => ({}));
        const cents = typeof d?.balance_cents === "number" ? d.balance_cents : null;
        if (cents != null) {
          if (baseline < 0) baseline = cents;
          if (cents > baseline) {                          // balance moved → the webhook credited
            setPay({ kind: "credited", creditedUsd: (wanted ?? (cents - baseline) / 100).toFixed(2), balanceUsd: (cents / 100).toFixed(2) });
            return;
          }
        }
      } catch { /* transient — keep polling */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Credited but the poll timed out (webhook lag) — reassure, don't error (the money's safe).
    setPay({ kind: "credited", creditedUsd: wanted != null ? wanted.toFixed(2) : "", balanceUsd: "" });
  }

  // Tear down any mounted Stripe form on unmount.
  useEffect(() => () => { try { checkoutRef.current?.destroy(); } catch { /* ignore */ } }, []);

  // Poll the Lightning invoice until paid/expired while an invoice is showing.
  useEffect(() => {
    if (pay.kind !== "invoice") return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(pay.pollUrl, { headers: { Accept: "application/json" } });
        const d = await res.json().catch(() => ({}));
        if (d?.status === "paid") {
          stop = true;
          setPay({ kind: "paid" });
          // Hand off to the freshly-funded agent's live page.
          setTimeout(() => { window.location.href = `/agent/${(handle || "").toLowerCase()}`; }, 1200);
          return;
        }
        if (d?.status === "expired" || Date.now() > pay.expiresAt) {
          stop = true;
          setPay({ kind: "error", message: "This invoice expired before it was paid. Start a new top-up." });
          return;
        }
      } catch {
        /* transient — keep polling */
      }
    };
    const id = setInterval(tick, 2500);
    return () => { stop = true; clearInterval(id); };
  }, [pay, handle]);

  return (
    <div className="keepcurrent">
      {/* ── HEADER ── */}
      <header className="page-hero">
        <div className="container">
          <h1>Top up your wallet</h1>
          <p className="lead">
            Add credit — anyone can. Continuous verification draws ~{FOUNDER_DAILY_CENTS}¢/day at the founding rate (~{DAILY_DEBIT_CENTS}¢/day standard) to keep{" "}
            {handle || "the agent"} reading <em>Current</em>.
          </p>
        </div>
      </header>

      {/* ── TOP UP (open) ── */}
      <section className="sect">
        <div className="container">
          {/* Which agent? Prefilled from ?handle= / ?agent=; editable so anyone with
              the handle can top up. /api/wallet/topup hard-requires it. */}
          <div className="handle-pick">
            <label htmlFor="kc-handle">Agent handle</label>
            <input
              id="kc-handle"
              type="text"
              placeholder="e.g. TARS-0A"
              autoComplete="off"
              spellCheck={false}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>

          <div className="plans">
            {PLANS.map((p) => (
              <div
                key={p.id}
                className={`plan${plan === p.id ? " sel" : ""}`}
                tabIndex={0}
                role="button"
                aria-pressed={plan === p.id}
                onClick={() => setPlan(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPlan(p.id);
                  }
                }}
              >
                <span className="pick"></span>
                <div className="pname">{p.name}</div>
                <div className="pamt">{p.amt}</div>
                <div className="pmeta">{p.meta}</div>
                {p.tag && <span className="ptag">{p.tag}</span>}
              </div>
            ))}

            <div
              className={`plan${plan === "custom" ? " sel" : ""}`}
              tabIndex={0}
              onClick={() => setPlan("custom")}
            >
              <span className="pick"></span>
              <div className="pname">Custom</div>
              <div className="custom-in">
                <span>$</span>
                <input
                  type="number"
                  min={2}
                  placeholder="amount"
                  inputMode="decimal"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onFocus={() => setPlan("custom")}
                />
              </div>
              <div className="pmeta">min $10 card · $2 crypto</div>
            </div>
          </div>

          <div className="pay-wrap">
            <div className="pay-grid">
              <button className="pay-btn card" onClick={() => onPay("card")}>
                Pay with card
                <span className="sub">Visa · Mastercard · Amex</span>
              </button>
              <button className="pay-btn crypto" onClick={() => onPay("lightning")}>
                Pay with Lightning
                <span className="bonus">+12% credit bonus</span>
              </button>
              <button className="pay-btn crypto" onClick={() => onPay("solana")}>
                Pay with Solana
                <span className="bonus">+8% credit bonus</span>
              </button>
            </div>
            <div className="wallet-info">
              <p>
                No subscriptions — the wallet pays for proof as it&apos;s produced, draining about{" "}
                <strong>{FOUNDER_DAILY_CENTS}¢/day</strong>; crypto bonuses stack straight onto it (more per dollar, not a
                discount). Top up any amount, any time.
              </p>
            </div>

            {pay.kind === "starting" && (
              <div className="pay-status show">
                <span className="spin"></span>
                <span>Setting up your {pay.label} payment…</span>
              </div>
            )}

            {/* EMBEDDED card form — mounts inline on our page, no bounce. Dark-carded container. */}
            {pay.kind === "embedded" && (
              <div className="embed-pay show">
                <div className="embed-head">Pay by card — securely, right here.</div>
                <div className="embed-mount" ref={embedRef} />
              </div>
            )}

            {pay.kind === "crediting" && (
              <div className="pay-status show">
                <span className="spin"></span>
                <span>Payment received — crediting your wallet…</span>
              </div>
            )}

            {pay.kind === "credited" && (
              <div className="pay-status show paid">
                <span>
                  {pay.creditedUsd ? `$${pay.creditedUsd} credited` : "Credited"}
                  {pay.balanceUsd ? ` · balance $${pay.balanceUsd}` : ""}. {handle || "Your agent"} stays Current.
                </span>
              </div>
            )}

            {pay.kind === "error" && (
              <div className="pay-status show err">
                <span>{pay.message}</span>
              </div>
            )}

            {pay.kind === "paid" && (
              <div className="pay-status show paid">
                <span>Payment received — opening {handle || "your agent"}&apos;s page…</span>
              </div>
            )}

            {pay.kind === "invoice" && (
              <div className="ln-invoice">
                <div className="ln-head">
                  <strong>Pay {pay.sats.toLocaleString()} sats over Lightning</strong>
                  <span>Scan or copy the invoice — this page updates the moment it&apos;s paid.</span>
                </div>
                <code className="ln-bolt11">{pay.bolt11}</code>
                <button
                  className="ln-copy"
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(pay.bolt11).catch(() => {})}
                >
                  Copy invoice
                </button>
                <div className="ln-wait">
                  <span className="spin"></span>
                  <span>Waiting for payment…</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

    </div>
  );
}
