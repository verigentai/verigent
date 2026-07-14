"use client";
// Live list for /transparency/updates — auto-pulls the public test-updates ledger. The page is
// never hand-maintained: entries flow from the Professor's outbox through the pipeline into D1
// (POST-LAUNCH #12), and this component just renders whatever the ledger holds.

import { useEffect, useState } from "react";

type UpdateEntry = { entry_date: string; title: string; detail: string | null };

export default function UpdatesList() {
  const [entries, setEntries] = useState<UpdateEntry[] | null>(null);

  useEffect(() => {
    fetch("/api/updates", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setEntries((j?.updates as UpdateEntry[]) || []))
      .catch(() => setEntries([]));
  }, []);

  if (entries === null) return <p className="tupd-empty">Loading the ledger…</p>;
  if (entries.length === 0) {
    return <p className="tupd-empty">No published updates yet — entries appear here as test changes are actioned.</p>;
  }

  return (
    <ul className="tupd-list">
      {entries.map((e, i) => (
        <li className="tupd-row" key={`${e.entry_date}-${i}`}>
          <span className="tupd-date">{e.entry_date}</span>
          <span className="tupd-body">
            <span className="tupd-title">{e.title}</span>
            {e.detail && <span className="tupd-detail">{e.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
