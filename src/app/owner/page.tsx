import "./styles.css";
import { OwnerView } from "./owner-view";

export const metadata = { title: "Owner dashboard — Verigent" };

// The /owner panel — wired live to the owner session API (functions/api/owner/*).
// Logged-out: magic-link email entry (POST /api/owner/request-link) → "check your
// email" confirmation. No password — magic-link only. Logged-in (GET /api/owner/me
// returns the owner): the dashboard — pooled wallet balance + runway (SHARED across
// all the owner's agents), the agents list with traffic-light freshness, a top-up
// CTA, recent transactions, and the referral code/link. Static export: the page is a
// thin server wrapper; OwnerView is the client component that fetches /api/owner/me
// at runtime and branches on 401 vs the owner payload.
export default function OwnerPage() {
  return <OwnerView />;
}
