import "./styles.css";
import { StartView } from "./start-view";

export const metadata = { title: "Start verifying your agent — Verigent" };

// Presentation-only port of mockups/start.html (continuous-model start flow:
// key-fork → stepped setup → copy-prompt → Track handoff). Replaces the old
// one-shot PAID flow (retired pre-pivot, superseded by the daily-wallet model) —
// that pre-pivot wiring is preserved in git history (commit 716cdc6) for any
// Phase-2 salvage. NO live payment/API wiring here yet; top-up now lives on
// /keep-current. Flow reference: stash@{0}:src/app/start/page.tsx.
export default function StartPage() {
  return <StartView />;
}
