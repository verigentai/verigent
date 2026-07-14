"use client";

import { useEffect } from "react";

// /leaderboard is retired — Verigent doesn't run a ranked leaderboard. The registry (with the
// Featured models view) is the home for verified agents. This redirects any old links there.
// A public/_redirects rule also handles this at the edge (301); this is the client-side fallback.
export default function LeaderboardRedirect() {
  useEffect(() => {
    window.location.replace("/registry");
  }, []);
  return null;
}
