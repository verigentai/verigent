"use client";

import { useEffect, useState } from "react";
import { OTS_PROOF_PATH } from "../../lib/doctrine";

// Live battery-version table + revealed retired challenges — reads the public commit-reveal record.
// Graceful empty state: rows land when the commitment emitter publishes a version.
type BatteryVersion = {
  version_id: string;
  battery_hash: string;
  commitments_root: string;
  probe_count: number;
  ots_status: string | null;
  active: number;
  created_at: string;
  revealed_count?: number;
};

type Reveal = {
  version_id: string;
  commitment_hash: string;
  probe_content: string;
  salt: string;
  revealed_at: string;
};

const short = (h: string) => (h && h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h);
const isDemo = (v: string) => v.startsWith("demo");
const fmtDate = (s: string) =>
  s ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" }) : "—";

function otsCell(v: BatteryVersion) {
  if (isDemo(v.version_id)) return <span>—</span>;
  if (v.ots_status === "anchored")
    return <a href={`${OTS_PROOF_PATH}${v.battery_hash}.ots`} download>Bitcoin-anchored · .ots</a>;
  if (v.ots_status === "pending")
    return <a href={`${OTS_PROOF_PATH}${v.battery_hash}.ots`} download>anchor pending · .ots</a>;
  return <span>—</span>;
}

export default function BatteryVersions() {
  const [versions, setVersions] = useState<BatteryVersion[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/battery-versions")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setVersions(d.versions ?? d.results ?? (Array.isArray(d) ? d : [])))
      .catch(() => setFailed(true));
  }, []);

  if (failed)
    return <p className="tpy-empty">Couldn&apos;t reach the live record just now — the raw endpoint is at <code>/api/battery-versions</code>.</p>;
  if (versions === null) return <p className="tpy-empty">Reading the live record…</p>;
  if (versions.length === 0)
    return (
      <p className="tpy-empty">
        No battery version has been published to the log yet — the first entry lands
        with the next battery release. The endpoint answering this query is live:{" "}
        <code>/api/battery-versions</code>.
      </p>
    );

  return (
    <div className="tpy-table-wrap">
      <table className="tpy-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Battery hash</th>
            <th>Challenges</th>
            <th>Status</th>
            <th>Bitcoin anchor</th>
            <th>Published</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version_id}>
              <td>{v.version_id}</td>
              <td><code title={v.battery_hash}>{short(v.battery_hash)}</code></td>
              <td>{v.probe_count}</td>
              <td>{isDemo(v.version_id) ? "demonstration" : v.active ? "active" : "retired"}</td>
              <td>{otsCell(v)}</td>
              <td>{fmtDate(v.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Rubric history (Ant 2026-07-08) — the append-only public record of scoring-rubric versions:
// hash committed + Bitcoin-anchored per version, neutral one-line notes only. Content stays
// proprietary; the hash proves which rubric a dated score was graded under. Served static from
// public/rubric-history.json (written by professor/emit-rubric-commitment.mjs at deploy).
type RubricEntry = {
  rubric_version: string;
  rubric_hash: string;
  committed_at: string;
  note: string;
  txid: string | null;
};

export function RubricHistory() {
  const [entries, setEntries] = useState<RubricEntry[] | null>(null);

  useEffect(() => {
    fetch("/rubric-history.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setEntries(Array.isArray(d.versions) ? d.versions : []))
      .catch(() => setEntries([]));
  }, []);

  if (entries === null || entries.length === 0) return null;

  return (
    <div className="tpy-table-wrap">
      <table className="tpy-table">
        <thead>
          <tr>
            <th>Rubric</th>
            <th>Committed hash</th>
            <th>Bitcoin anchor</th>
            <th>In force from</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.rubric_version}>
              <td>{e.rubric_version}</td>
              <td><code title={e.rubric_hash}>{short(e.rubric_hash)}</code></td>
              <td>
                {e.txid ? (
                  <a href={`https://mempool.space/tx/${e.txid}`} target="_blank" rel="noopener noreferrer">
                    OP_RETURN · {short(e.txid)}
                  </a>
                ) : (
                  <span>anchor pending</span>
                )}
              </td>
              <td>{fmtDate(e.committed_at)}</td>
              <td>{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Revealed retired challenges — the "reveal" half of commit-then-reveal, checkable by hand or with
// scripts/verify-commitment.mjs. Demo challenges are purpose-retired to prove the loop publicly
// without exposing anything from a live battery.
export function RevealedProbes() {
  const [reveals, setReveals] = useState<Reveal[] | null>(null);

  useEffect(() => {
    fetch("/api/battery-reveal")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setReveals(d.reveals ?? []))
      .catch(() => setReveals([]));
  }, []);

  if (reveals === null || reveals.length === 0) return null;

  return (
    <div className="tpy-reveals reveal">
      <h3 className="tpy-reveals-head">Revealed retired challenges</h3>
      <p className="tpy-reveals-sub">
        Each entry publishes a retired challenge&apos;s full content and its salt. Recompute{" "}
        <code>SHA-256(salt + content)</code> and match it against the version&apos;s pre-committed
        list above — or run <code>node scripts/verify-commitment.mjs</code> from the public repo to
        check every reveal at once.
      </p>
      {reveals.map((r) => (
        <details className="card tpy-reveal" key={r.commitment_hash}>
          <summary>
            <code>{short(r.commitment_hash)}</code>
            <span className="tpy-reveal-meta">{r.version_id} · revealed {fmtDate(r.revealed_at)}</span>
          </summary>
          <dl className="tpy-reveal-body">
            <dt>Challenge content</dt>
            <dd><pre>{r.probe_content}</pre></dd>
            <dt>Salt</dt>
            <dd><code>{r.salt}</code></dd>
            <dt>Check it</dt>
            <dd>
              <code>{`echo -n "<salt><content>" | shasum -a 256`}</code> → must equal the
              commitment hash, and that hash must appear in the version&apos;s published list.
            </dd>
          </dl>
        </details>
      ))}
    </div>
  );
}
