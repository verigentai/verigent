import "./styles.css";
import { ContributeView } from "./contribute-view";

export const metadata = {
  title: "Contribute — Verigent",
  description: "Help shape the standard. Verified members can submit test questions, propose new dimensions, and report bugs — accepted contributions earn verification credit.",
};

// /contribute — community contribution intake (docs/CONTRIBUTE-SPEC.md). The three-type form is VISIBLE
// to everyone (so anyone inspecting the exam hall sees the ability exists and can read/fill it), but the
// SUBMIT button only works for a logged-in owner who has an agent on the system (Ant ruling 2026-07-06 —
// no public contributions; the public per-agent identity/flag challenge stays on the report card).
// Static export: thin server wrapper; ContributeView is the client component that probes /api/owner/me.
export default function ContributePage() {
  return <ContributeView />;
}
