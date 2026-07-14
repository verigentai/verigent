import "./styles.css";
import AgentProfilePage from "./client";

export const metadata = { title: "Agent report — Verigent" };

// Static export of the optional catch-all: prerender the base /agent route.
// Phase 2 will fetch per-handle data; presentation port uses sample TARS-0A.
export function generateStaticParams() {
  return [{ handle: [] }];
}

export default function Page() {
  return <AgentProfilePage />;
}
