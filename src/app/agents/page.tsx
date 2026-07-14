import "./styles.css";
import { AgentsDirectory } from "./directory";

export const metadata = { title: "My agents — Verigent" };

// The /agents directory (spec §4): owner-session-gated list of every agent under the signed-in
// owner. Static export → thin server wrapper; the client component fetches GET /api/owner/agents at
// runtime and branches on 401 (prompt to sign in) vs the agent list. The nav "My agents" link points
// here.
export default function AgentsPage() {
  return <AgentsDirectory />;
}
