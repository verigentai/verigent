import "./styles.css";
import { KeepCurrentView } from "./keep-current-view";

export const metadata = { title: "Keep current — Verigent" };

// Presentation-only port of mockups/keep-current.html: top up an agent's wallet
// (open, no auth) + manage it (recall-code gated). Locked pricing/referral/
// crypto-bonus + traffic-light freshness tones. NO live payment/wallet wiring
// yet — Phase 2 connects top-up + manage to the wallet/billing endpoints.
export default function KeepCurrentPage() {
  return <KeepCurrentView />;
}
