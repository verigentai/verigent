"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import "./styles.css";

type ChallengeResult = { valid: boolean; nonce: string; signature: string; reason: string };

function VerifyInner() {
  const searchParams = useSearchParams();
  const [handle, setHandle] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The challenge result is lifted here so the mismatch report only appears AFTER a failed
  // challenge — a match needs no report — and arrives pre-filled with the failed nonce/signature.
  const [challenge, setChallenge] = useState<ChallengeResult | null>(null);

  // Mismatch report (only shown on a failed challenge).
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reporter, setReporter] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [reporting, setReporting] = useState(false);

  async function lookup(h: string) {
    const v = h.trim().replace(/^@/, "");
    if (!v) return;
    setLoading(true); setError(""); setData(null); setChallenge(null);
    try {
      const r = await fetch(`/api/verify/${encodeURIComponent(v)}`);
      const d = await r.json();
      if (!r.ok || (d.verified === false && d.error)) {
        setError(d.error === "AGENT_NOT_FOUND" ? `No verified agent found with handle "${v}".` : (d.error || "Lookup failed."));
      } else {
        setData(d);
      }
    } catch {
      setError("Couldn't reach the verification service.");
    }
    setLoading(false);
  }

  useEffect(() => {
    const h = searchParams?.get("handle");
    if (h) { setHandle(h); lookup(h); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // On a failed challenge, pre-fill the mismatch report with the exact failed nonce + signature so
  // the reporter files evidence, not a bare form.
  function onChallengeResult(res: ChallengeResult) {
    setChallenge(res);
    if (!res.valid) {
      setReason("Identity challenge failed — the signature did not verify against the key bound at test time.");
      setEvidence(`Failed challenge for ${data?.handle || handle}\nNonce: ${res.nonce}\nSignature: ${res.signature}\nResult: ${res.reason}`);
    }
  }

  async function submitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!data?.handle || !reason.trim()) return;
    setReporting(true); setReportStatus("");
    try {
      const r = await fetch(`/api/report/${encodeURIComponent(data.handle)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), evidence: evidence.trim() || undefined, reporter: reporter.trim() || undefined }),
      });
      const d = await r.json();
      if (d.ok) {
        setReportStatus("✓ Report filed — this agent is now publicly flagged as disputed, and it's queued for review. Thanks for keeping the network honest.");
        lookup(data.handle);
      } else {
        setReportStatus(d.error || "Couldn't file the report.");
      }
    } catch {
      setReportStatus("Couldn't reach the report service.");
    }
    setReporting(false);
  }

  const disputed = data?.verification_status === "disputed" || (data?.dispute_count ?? 0) > 0;
  const bound = !!data?.identity?.public_key;

  return (
    <div className="vf-wrap">
      <div className="vf-head">
        <h1 className="vf-title">Challenge an agent&apos;s identity</h1>
        <p className="vf-lead">
          A live cryptographic check that the agent you&apos;re dealing with is the exact one Verigent
          tested — not an impersonator or a swapped model. Instant, and anyone can run it.
        </p>
      </div>

      {/* Lookup — pre-filled when you arrive from a report, editable to challenge any agent. */}
      <form onSubmit={(e) => { e.preventDefault(); lookup(handle); }} className="vf-form">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="Agent handle (e.g. chunk-0A)"
          className="vf-input"
        />
        <button type="submit" className="vf-btn">Look up</button>
      </form>

      {loading && <p className="vf-msg">Looking up…</p>}
      {error && <p className="vf-msg vf-err">{error}</p>}

      {data && (
        <div className="vf-results">
          {/* Compact agent banner — just enough to confirm which agent you're challenging (the full
              tier/class/composite live on the report you came from). */}
          <div className={`vf-banner ${disputed ? "vf-disp" : "vf-ok"}`}>
            <div className="vf-banner-row">
              <div>
                <span className="vf-banner-name">{data.display_name}</span>
                <span className="vf-banner-handle">{data.handle}</span>
              </div>
              <div className="vf-banner-actions">
                {disputed ? (
                  <span className="vf-pill vf-disp">⚠ Disputed{(data.dispute_count ?? 0) > 0 ? ` (${data.dispute_count})` : ""}</span>
                ) : bound ? (
                  <span className="vf-pill vf-ok">✓ Verified · identity bound</span>
                ) : (
                  <span className="vf-pill vf-neutral">Tested &amp; listed · no identity key bound</span>
                )}
                <Link className="vf-report-link" href={`/agent/${data.handle}`}>Full report →</Link>
              </div>
            </div>
            {data.stale && data.staleness_warning && <p className="vf-stale">{data.staleness_warning}</p>}
          </div>

          {/* TIER 1 — BASIC provenance, every tested agent. An explicit, labelled "is this a real,
              on-chain-anchored tested agent?" check (previously just the silent Full-report link). */}
          <div className="vf-card vf-prov">
            <div className="vf-prov-head">
              <span className="vf-prov-label">Basic provenance</span>
              <Link className="vf-report-link" href={`/agent/${data.handle}`}>Full report →</Link>
            </div>
            <p className="vf-body">This agent&apos;s VG credential is genuine and listed in the Verigent registry.</p>
            <ul className="vf-prov-list">
              <li><span>VG code</span><code>{data.vg_code}</code></li>
              <li><span>Standing</span><b>{data.tier}{data.primary_class ? ` · ${data.primary_class}` : ""}</b></li>
              <li><span>Score</span><b>{data.composite ?? "—"}</b></li>
              <li><span>On-chain anchor</span>{data.anchor?.txid
                ? <a href={`https://mempool.space/tx/${data.anchor.txid}`} target="_blank" rel="noopener noreferrer">Anchored on Bitcoin ↗</a>
                : <span className="vf-muted">pending next attestation</span>}</li>
              <li><span>Freshness</span><b>{data.freshness?.label || (data.stale ? "Stale" : "Current")}</b></li>
            </ul>
          </div>

          {/* TIER 2 — FULL live challenge, only for agents that bound a key (sovereign). */}
          {bound ? (
            <div className="vf-card">
              <div className="vf-ch-head">
                <span className="vf-prov-label">Full live challenge</span>
                <span className="vf-fingerprint">key ({data.identity.algorithm}): <code>{data.identity.public_key.length > 24 ? `${data.identity.public_key.slice(0, 12)}…${data.identity.public_key.slice(-8)}` : data.identity.public_key}</code></span>
              </div>
              {/* Stepped explainer for a human challenger: what · why · how, ending in the action. */}
              <ol className="vf-steps">
                <li><b>What this proves.</b> That the agent replying to you controls the key bound to this VG credential — so it&apos;s the one that earned the score, not a lookalike.</li>
                <li><b>Why it&apos;s trustworthy.</b> You pick the random nonce, so nobody can pre-compute the answer. We only check the signature against the key bound when the agent was tested — no testing, nothing to game.</li>
                <li><b>How it works.</b> Give the agent the nonce below, ask it to sign with its Verigent identity key ({data.identity.algorithm}), paste the signature back. We verify it on the spot.</li>
              </ol>
              <ChallengeWidget handle={data.handle} algorithm={data.identity.algorithm} onResult={onChallengeResult} />
            </div>
          ) : (
            <div className="vf-card">
              <p className="vf-body"><b>Live challenge isn&apos;t available for this agent yet.</b> It hasn&apos;t completed sovereignty verification, so its identity can&apos;t be cryptographically challenged.</p>
              <p className="vf-body vf-muted">
                Agents unlock live challenge by completing a sovereignty verification — the agent
                generates a keypair and proves control of it as part of the sovereignty battery. Once
                bound, anyone can challenge it live from this page.{" "}
                <Link href={`/agent/${data.handle}`}>See this agent&apos;s report →</Link>
              </p>
            </div>
          )}

          {/* Mismatch report — ONLY after a failed challenge, pre-filled with the failed nonce/sig. */}
          {challenge && !challenge.valid && (
            <div id="report" className="vf-report">
              <h2>The signature didn&apos;t match — report it</h2>
              <p className="vf-body vf-muted">
                A failed challenge means the agent couldn&apos;t sign for the key bound to this
                credential — a possible impersonation or model swap. Filing raises a <b>public dispute
                flag</b> everyone can see and queues it for Verigent to review. Your evidence below is
                pre-filled from the failed challenge; add anything else you saw.
              </p>
              <form onSubmit={submitReport} className="vf-report-form">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="vf-field" placeholder="What looks wrong? (required)" />
                <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={4} className="vf-field" placeholder="Evidence" />
                <input value={reporter} onChange={(e) => setReporter(e.target.value)} className="vf-field" placeholder="Your handle or contact (optional)" />
                <button type="submit" disabled={reporting || !reason.trim()} className="vf-report-btn">
                  {reporting ? "Filing…" : "File dispute report"}
                </button>
                {reportStatus && <p className="vf-report-status">{reportStatus}</p>}
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Live identity challenge: we mint a fresh nonce in the browser (the CALLER controls freshness —
// that's the point of the scheme), the visitor gets the agent to sign it, pastes the signature,
// and we verify it against the bound key via POST /api/verify/identity-challenge.
function ChallengeWidget({ handle, algorithm, onResult }: { handle: string; algorithm: string; onResult: (r: ChallengeResult) => void }) {
  const [nonce, setNonce] = useState("");
  const [signature, setSignature] = useState("");
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ valid: boolean; reason: string } | null>(null);

  const mintNonce = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    setNonce(`verigent-challenge-${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`);
    setSignature(""); setResult(null);
  };
  useEffect(() => { mintNonce(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => {
    navigator.clipboard?.writeText(`Sign this nonce with your Verigent identity key (${algorithm}) and give me the signature: ${nonce}`).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };

  async function check() {
    if (!signature.trim()) return;
    setChecking(true); setResult(null);
    try {
      const r = await fetch("/api/verify/identity-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, nonce, signature: signature.trim() }),
      });
      const d = await r.json();
      const reason = d.reason || d.hint || (d.valid ? "Signature verified." : "Signature did not verify.");
      setResult({ valid: !!d.valid, reason });
      onResult({ valid: !!d.valid, nonce, signature: signature.trim(), reason });
    } catch {
      const reason = "Couldn't reach the verification service.";
      setResult({ valid: false, reason });
      onResult({ valid: false, nonce, signature: signature.trim(), reason });
    }
    setChecking(false);
  }

  return (
    <div className="vf-challenge">
      <p className="vf-ch-label">1 · Send the agent this challenge</p>
      <div className="vf-ch-nonce">
        <code>{nonce}</code>
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy ask"}</button>
        <button type="button" onClick={mintNonce}>New nonce</button>
      </div>
      <p className="vf-ch-label">2 · Paste the signature it returns</p>
      <textarea
        className="vf-field" rows={2} value={signature}
        placeholder="base64 or hex signature"
        onChange={(e) => { setSignature(e.target.value); setResult(null); }}
      />
      <button type="button" className="vf-btn vf-ch-btn" disabled={checking || !signature.trim()} onClick={check}>
        {checking ? "Verifying…" : "Verify signature"}
      </button>
      {result && (
        <p className={`vf-ch-result ${result.valid ? "ok" : "bad"}`}>
          {result.valid ? "✓ Identity proven — this is the tested agent." : `✗ ${result.reason}`}
        </p>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="vf-state">Loading…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
