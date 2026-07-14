// functions/lib/referral-standing.ts — referral STANDING tiers (locked pricing 2026-06-30:
// the flat $2/mo referral credit is capped at the ~$2/mo cost floor; referrals past the cap earn
// STANDING, not cash). One owner-level mapping shared by the API and the front-end (imported like
// the test manifest — the seam pattern). Register is ratings-agency neutral: recognition of a
// contribution record, never game language.

export interface ReferralStanding {
  key: string;
  label: string;
  min_active: number;
}

// Thresholds on ACTIVE referrals (status='active' — referred owners who actually fund and verify).
export const REFERRAL_STANDINGS: ReferralStanding[] = [
  { key: 'ambassador', label: 'Ambassador', min_active: 10 },
  { key: 'advocate',   label: 'Advocate',   min_active: 3 },
  { key: 'referrer',   label: 'Referrer',   min_active: 1 },
];

export function referralStanding(activeReferrals: number): ReferralStanding | null {
  for (const s of REFERRAL_STANDINGS) {
    if (activeReferrals >= s.min_active) return s;
  }
  return null;
}
