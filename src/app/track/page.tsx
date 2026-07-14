import "./styles.css";
import { TrackView } from "./track-view";

export const metadata = { title: "Track your run — Verigent" };

// Presentation-only port of mockups/track.html (locked Equiem design, 25 dims /
// 4 pillars, freshness Current/Ageing/Stale). The prior live-wired viewer (old
// one-shot model: /api/result + /api/coupon polling, on-chain tx links, live
// sovereignty feed) is preserved in git history — see commit ee51b31 — and is
// the reference for Phase-2 rewiring against the continuous-run API. Do NOT wire
// live APIs here yet.
export default function TrackPage() {
  return <TrackView />;
}
