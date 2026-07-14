// CANONICAL test-run duration — the ONE owner of "how long a full verification takes" and "how long
// the session window is". Every duration mention on the site AND in emails derives from here
// (docs/CANONICAL.md). Change it here and it updates everywhere — no hand-copied per-page literals.
//
// Values from MEASURED live runs: two real runs completed at 24.5 and 23.2 min (start→report).
// We quote "about 30 minutes" to slightly UNDER-PROMISE (they expect 30, it lands ~24). The hard
// session window (TEST_WINDOW_MINUTES) sits ABOVE the quoted duration so a slower agent has buffer.
export const TEST_DURATION_MIN_MINUTES = 20;
export const TEST_DURATION_MAX_MINUTES = 30;

// The hard session window before a run expires. run.ts computes expiresAt from this; the run-expired
// email describes it. Single source so "N-minute session window" can never drift from the real cap.
export const TEST_WINDOW_MINUTES = 45;

// Display labels — every "how long does it take" mention derives from these.
export const TEST_DURATION_LABEL = `about ${TEST_DURATION_MAX_MINUTES} minutes`;
export const TEST_WINDOW_LABEL = `${TEST_WINDOW_MINUTES} minutes`;
