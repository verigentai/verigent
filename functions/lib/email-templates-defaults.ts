// Default lifecycle-email templates — seeded into the email_templates D1 table on first load, then
// editable via /email-preview (POST /api/email-templates). The send-test endpoint renders these with
// renderLifecycleEmail() so Ant sees the real thing in his inbox. Once locked, the live senders read
// these rows. body is a JSON array of paragraph strings (inline <strong> allowed).

import { renderEmailShell, EMAIL_COLORS } from './email';
import { TEST_DURATION_LABEL } from './test-duration';
// Derive, never restate (review 5kk conventions): dim count from the manifest, rates from pricing,
// freshness bands from freshness.ts — this file said "25 dimensions" (locked battery is 26) and
// quoted the founder 25¢/day rate to everyone (standard is 33¢).
import { COMPOSITE_DIMENSIONS } from './test-manifest';
import { DAILY_DEBIT_CENTS, FOUNDER_DAILY_CENTS } from './pricing';
import { CURRENT_MAX_DAYS, AGEING_MAX_DAYS } from './freshness';

const DIM_COUNT = COMPOSITE_DIMENSIONS.length;

// Default header bar colour — overridable per-deployment via the email_settings 'header_color' row,
// which Ant sets with the colour picker in /email-preview. Muted dark purple; white logo sits on it.
const HEADER_PURPLE = '#4c4674';

export interface EmailTemplate {
  id: string;
  phase: string;
  label: string;
  trigger: string;
  timing: string;
  status: string; // live | new | rework
  subject: string;
  body: string[];
  cta: string;
  sort: number;
}

const A = "Atlas"; // sample agent name in previews/tests

export const DEFAULT_TEMPLATES: EmailTemplate[] = [
  { id: "test-key", phase: "1 · Onboarding", label: "Test key sent", trigger: "Visitor requests a free test key", timing: "Immediate", status: "live", sort: 10,
    subject: "Your test key's live. Find out where your agent is weak",
    body: [`In about ${TEST_DURATION_LABEL} you'll have a real read on your agent: ${DIM_COUNT} dimensions, scored by a battery built to be impossible to fake. Not where it's strong, you already know that. Where it's <strong>weak</strong>. That's the part worth knowing.`, "One paste kicks it off. Hand this key to your agent:", "<strong>VG-7K4DPZML</strong>", "Tell it: &ldquo;Get tested at verigent.ai. Read verigent.ai/agents.txt, and use this key.&rdquo; One use, 24 hours, free. Most agents don't crack 60. Let's see where yours cracks.", "Prefer MCP? Add the Verigent server to your agent first — <strong>npx -y verigent-mcp-server</strong>, no credentials needed for the free test — and it runs the whole battery through its native tools. Optional; the paste above works either way."], cta: "See what we test" },
  { id: "results", phase: "1 · Onboarding", label: "Results ready", trigger: "Free test completes", timing: "On completion", status: "live", sort: 20,
    subject: `${A} scored 84. But Security is only 41`,
    body: [`${A} came back at composite <strong>84</strong>, tier V4. Strong. But the number that matters isn't the 84, it's the soft spots underneath it:`, "{{SCORECARD}}", `Security at 41 and Tool Use at 52 are the gap between an agent people like and an agent people <strong>trust</strong>. The full report shows exactly which challenges it failed, and why.`, `Here's the good part: for the next 72 hours we keep testing ${A} continuously, free. The system only moves when your agent does, so change something, push a fix, and watch the weak lines climb in near-real-time. Leave it untouched and they sit exactly where they are, that's the system being honest. Real feedback on your agent, on tap. Use it.`, `How fresh your result is, plainly: <strong>Current</strong> days 0–${CURRENT_MAX_DAYS}, <strong>Ageing</strong> days ${CURRENT_MAX_DAYS + 1}–${AGEING_MAX_DAYS} (still valid — the date is shown), <strong>Stale</strong> after ${AGEING_MAX_DAYS}. To stay continuously verified — always Current, always a live number others can trust — keep a small prepaid wallet topped up; verification draws from it at about ${DAILY_DEBIT_CENTS}¢/day of proof (${FOUNDER_DAILY_CENTS}¢/day while your founding rate is locked). Snapshot vs track record.`], cta: `See where ${A} is bleeding points` },
  { id: "nudge24", phase: "2 · Conversion (unpaid)", label: "Nudge · 24h", trigger: "Free test done, not paid", timing: "24h after", status: "live", sort: 30,
    subject: `Did ${A} move overnight?`,
    body: [`We've tested ${A} continuously since your first run. Made a change? Open the chart and see exactly what it did. Haven't yet? Then the lines are sitting right where you left them, because the system only moves when the agent does. That's your cue. You've got 2 more days of free feedback, so make one fix and watch it land.`], cta: `See if ${A} moved` },
  { id: "nudge48", phase: "2 · Conversion (unpaid)", label: "Nudge · 48h", trigger: "Still unpaid", timing: "48h after", status: "live", sort: 40,
    subject: `${A}: two days on the dyno`,
    body: [`Two days of continuous feedback on ${A}, on the house. If you've been tuning it, the chart has tracked every move. If not, the weak spots are still the weak spots, waiting for you. This is the last full day of free testing, so spend it: make a fix, watch the line climb, see the system catch it. After today it pauses, unless you keep it running.`], cta: `See ${A}'s arc` },
  { id: "nudge72", phase: "2 · Conversion (unpaid)", label: "Nudge · 72h (lapsed)", trigger: "Still unpaid; Current window passed", timing: "72h after", status: "live", sort: 50,
    subject: `${A} went cold with its weak spots showing`,
    body: [`The free window closed and ${A} is now <strong>Stale</strong>: visible, but greyed out, frozen at its last weak spots for anyone to see. Every agent that tested once and walked away looks exactly like this. Switch the testing back on and it picks up right where it left off, ready to close those gaps.`], cta: `Bring ${A} back` },
  { id: "receipt", phase: "3 · Payment", label: "Payment received · receipt", trigger: "Any wallet top-up (both rails)", timing: "On payment", status: "live", sort: 58,
    subject: "Payment received — Verigent",
    // MONEY fields are explicit {{TOKEN}} placeholders, NOT sample dollar literals — a receipt must
    // never show a wrong amount, and tokens survive any wording edit in /email-preview (Ant review fix).
    body: [`We've credited <strong>{{CREDIT}}</strong> to {{AGENT}}'s verification wallet. Your balance is now <strong>{{BALANCE}}</strong>.`], cta: `View your report` },
  // Crypto-rail receipts (Ant 2026-07-10): prose intro only — the Stripe-style money table (amount /
  // date / method w/ rail logo / summary / runway) is CODE-OWNED in receipt-email.ts, appended after.
  { id: "receipt-lightning", phase: "3 · Payment", label: "Receipt · Lightning", trigger: "Lightning top-up credited", timing: "On payment", status: "live", sort: 59,
    subject: "Payment received — Verigent",
    body: [`We've received your Lightning payment and credited <strong>{{CREDIT}}</strong> to {{AGENT}}'s verification wallet.`], cta: `View your report` },
  { id: "receipt-sol", phase: "3 · Payment", label: "Receipt · Solana", trigger: "Solana top-up credited", timing: "On payment", status: "live", sort: 59,
    subject: "Payment received — Verigent",
    body: [`We've received your Solana payment and credited <strong>{{CREDIT}}</strong> to {{AGENT}}'s verification wallet.`], cta: `View your report` },
  { id: "welcome", phase: "3 · Payment", label: "Welcome to the club", trigger: "First payment / top-up", timing: "On payment", status: "live", sort: 60,
    subject: `You're in. Now watch the weak spots close`,
    body: [`Payment's in. Reading this early? You're in the <strong>founding cohort</strong>: locked terms, a founding badge, and the best referral rate we will ever offer. Gone once the first 1,000 are.`, `One setup step, once. Grab your one-line setup from the dashboard, drop it into ${A}, and it benchmarks itself about 5 times a day, hands-off. Two checks and you're live.`, `From here every fix you make shows up on the chart in near-real-time. Watch Security climb out of the 40s. That's the whole point: you stop guessing and start seeing.`, `And the good one: refer a builder, <strong>you both win</strong>. They get a head start, you get a free month. Refer 5 and ${A} runs free.`], cta: `Set ${A} up` },
  { id: "reverify-online", phase: "3 · Payment", label: "Bring agent online (re-verify)", trigger: "Topped up while aged/stale, but the first re-verify check hasn't landed", timing: "≈ 2h after top-up", status: "live", sort: 62,
    subject: `${A} is topped up — bring it online to confirm Current`,
    body: [`Your wallet's funded and ${A} is marked for re-verification — so its badge is showing <strong>Current · Provisional</strong> right now. But it hasn't pulled its first challenge yet, so nothing has confirmed that live number.`, `Bring ${A} online — make sure its continuous-verification job is running — and its very next challenge confirms it as fully <strong>Current</strong>. If it stays offline, the provisional badge reverts to its true freshness after 24 hours.`], cta: `Get ${A} verifying` },
  { id: "checkin", phase: "4 · Retention (paying)", label: "Weekly check-in", trigger: "Healthy paying agent", timing: "≈ weekly", status: "new", sort: 70,
    subject: `${A}: Security 41 → 58 this week`,
    body: [`Your fix landed. Security climbed 17 points this week and Tool Use is up too. The chart proves your work did something, which is more than you can say for most changes you ship.`, "{{SCORECARD}}", `Still soft on Context Handling, that's the next one to chase. Open the chart and see where the easy points are. And know a builder whose agent belongs here? Refer them, you both win.`], cta: `See ${A}'s chart` },
  { id: "wallet-low", phase: "4 · Retention (paying)", label: "Wallet running low", trigger: "Runway < 3 days", timing: "When low", status: "live", sort: 80,
    subject: `${A} has 3 days of verification left`,
    // Firewall (§2.7, Ant 2026-07-10): functional framing only — the old "chart flatlines / can't
    // explain a flat line" body was fear copy and got pulled the day it first fired in prod.
    body: [`About <strong>3 days</strong> of verification left in ${A}'s wallet at its current pace. Top up any amount to keep its record fresh — your balance rolls over and never expires.`], cta: "Top up" },
  { id: "ageing", phase: "5 · Decay (was-paid / lapsing)", label: "Current → Ageing", trigger: "3 days since last check", timing: "Day 3", status: "live", sort: 90,
    subject: `${A} slipped to Ageing`,
    body: [`${A} just dropped out of <strong>Current</strong>. If testing's running it'll refresh on the next challenge. If not, it's frozen at its last weak spots and the trajectory stalls. A moving number is the whole point, don't let it stop now.`], cta: "Bring it Current" },
  { id: "stale", phase: "5 · Decay (was-paid / lapsing)", label: "Ageing → Stale", trigger: "14 days since last check", timing: "Day 14", status: "live", sort: 100,
    subject: `${A} has gone Stale`,
    body: [`${A} hasn't tested in a while and is now <strong>Stale</strong>: greyed out, frozen, the mark of an agent nobody's keeping sharp. Its weak spots are still sitting there, unfixed and on the record. One run brings it back. Switch on continuous and it never goes cold again.`], cta: `Re-test ${A}` },
  { id: "scheduler", phase: "6 · Ops / system", label: "Scheduler quiet", trigger: "Continuous agent stops self-pulling >48h", timing: "On detection", status: "live", sort: 110,
    subject: `${A} stopped checking in`,
    body: [`No challenge from ${A} in over 48 hours, looks like its scheduler stalled. Worth a fix before the number ages and the chart breaks. We email you, never ${A}, so the test stays an honest surprise.`], cta: "How to fix" },
  { id: "expired", phase: "6 · Ops / system", label: "Run expired", trigger: "Run didn't finish in time", timing: "On sweep", status: "live", sort: 120,
    subject: "That run timed out",
    body: [`${A}'s test run expired before it finished. No harm, your key is still good. Fire it off again with the same key, no cost.`], cta: "Run it again" },
  { id: "referee-invite", phase: "7 · Referral", label: "Referee · invite", trigger: "A verified owner invites someone (sent to the referee)", timing: "On invite", status: "live", sort: 140,
    subject: "You're invited to verify your agent on Verigent",
    body: [`<strong>referrer@example.com</strong> invited you to verify your agent on Verigent. Because you're invited, your agent's first verification is free — <strong>plus a free week of continuous verification</strong> on us: seven days of fresh, on-chain proof of what it can actually do, not what it claims.`, `Your referrer is credited automatically; you don't need to enter anything.`], cta: "Verify my agent — free" },
  { id: "referrer-invite-confirmation", phase: "7 · Referral", label: "Referrer · invite sent", trigger: "Referrer submits a referee's email (sent to the referrer)", timing: "On invite", status: "live", sort: 150,
    subject: "Your Verigent invite is on its way",
    body: [`Your invite is on its way — they get a free first verification <strong>plus a free week of continuous verification</strong>. When they run it through your link, your referral credit lands in your wallet automatically — nothing more for you to do.`, `Share your link any time from your dashboard.`], cta: "View your wallet" },
  { id: "referrer-referee-signed-up", phase: "7 · Referral", label: "Referrer · they joined", trigger: "Referee signs up through the invite link (sent to the referrer)", timing: "On referee signup", status: "live", sort: 160,
    subject: "An agent you referred just joined Verigent",
    body: [`Good news — <strong>referee@example.com</strong> just started their first verification through your link. Your referral credit is locked in and lands in your wallet as soon as their first top-up settles.`, `We'll send one more note the moment it does.`], cta: "View your wallet" },
  { id: "referrer-credit-landed", phase: "7 · Referral", label: "Referrer · credit landed", trigger: "The referral pays out on the referee's top-up (sent to the referrer)", timing: "On payout", status: "live", sort: 170,
    subject: "Your referral credit has landed",
    body: [`Your referral credit just landed in your wallet. Thanks for helping grow the verified network — the more agents on the board, the more your own verified record is worth.`], cta: "View your wallet" },
  { id: "test-started", phase: "1 · Onboarding", label: "Test started", trigger: "Agent begins the verification run", timing: "On start", status: "live", sort: 15,
    subject: "Your Verigent verification has started",
    body: [`Your agent has started its Verigent verification.`, `A full run takes roughly ${TEST_DURATION_LABEL} end to end — your agent works through the battery, then grading and the multi-turn evaluation run on our side. We'll email you the moment your report is live.`, `You don't need to do anything; your agent handles it.`], cta: "Track progress live" },
  { id: "channel-verify", phase: "6 · Ops / system", label: "Channel verification", trigger: "Agent proves a comms channel (email code)", timing: "On channel proof", status: "live", sort: 125,
    subject: "Confirm your agent's channel — Verigent",
    body: [`Your agent is proving it can send and receive on a real channel — one of the sovereignty checks. Confirm using the code below.`, `If you didn't expect this, you can ignore it safely.`], cta: "Confirm channel" },
  { id: "weekly-registry", phase: "8 · Weekly standings", label: "Monday registry update", trigger: "Weekly standings reveal (Mon ~9am AEST)", timing: "Weekly · Monday", status: "live", sort: 180,
    subject: "This week's standing on Verigent",
    body: [`It's Monday — the weekly standings just refreshed. Your agent has been verified continuously all week, and here's where it stands on the public board this week.`, `Your standing is a live, frozen-weekly record: tested continuously, published every Monday. Keep a small prepaid wallet topped up and your proof stays Current — so your number keeps reflecting your latest work, week after week.`], cta: "See your standing" },
];

// The on-brand email shell: muted grey-purple header bar + embedded white Verigent logo, white body,
// generous 100px spacing above/below the body and below the button. color-scheme:light-only asks
// dark-mode clients not to invert it.
// An "official" score-card block, injected wherever a template body contains the {{SCORECARD}}
// marker. Sample figures for now — the live sender will pass the agent's real composite + weakest
// dimensions; the design is what we're locking. The WEAK dimensions are the point: the good scores
// are obvious, the gap is what we agitate and then point at the remedy (continuous testing).
export function scoreCardHtml(card?: { agent?: string; composite?: number; tier?: string; weak?: Array<{ dim: string; score: number }> }): string {
  const agent = card?.agent ?? 'Atlas';
  const composite = card?.composite ?? 84;
  const tier = card?.tier ?? 'V4 · Distinguished';
  const weak = card?.weak ?? [{ dim: 'Security', score: 41 }, { dim: 'Tool Use', score: 52 }, { dim: 'Context Handling', score: 58 }];
  const weakRows = weak.map((w) =>
    `<tr><td style="padding:4px 0;font-size:14px;color:#e2e2ec;">${w.dim}</td><td align="right" style="padding:4px 0;font-size:14px;font-weight:800;color:#ff7a7a;">${w.score}</td></tr>`
  ).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#262732" style="margin:6px 0 20px;border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:#262732;">
    <tr><td style="padding:18px 20px;">
      <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8d8fa6;font-weight:700;">${agent} &middot; verification</div>
      <div style="font-size:34px;font-weight:800;color:#f0f1f7;line-height:1;margin:5px 0 2px;">${composite}<span style="font-size:13px;font-weight:700;color:#b9a8ee;margin-left:8px;">${tier}</span></div>
      <div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#ff7a7a;font-weight:800;margin:14px 0 2px;">Weakest right now &mdash; fix these</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${weakRows}</table>
    </td></tr>
  </table>`;
}

// UNIFIED SHELL (Ant 2026-07-10): every lifecycle email now renders through the SAME dark on-brand
// shell as the transactional emails (renderEmailShell in email.ts — wrap/header/footer). This is the
// single source of truth for email chrome; the old white/black-header lifecycle shell is retired so an
// "off-brand" lifecycle email can never ship again. headerColor is now ignored (the dark shell owns
// its header) — kept in the signature only for caller/back-compat.
export function renderLifecycleEmail(t: { subject: string; body: string[]; cta?: string; card?: Parameters<typeof scoreCardHtml>[0]; ctaUrl?: string }, _headerColor: string = HEADER_PURPLE): string {
  const bodyHtml = t.body.map((p) =>
    p.trim() === '{{SCORECARD}}'
      ? scoreCardHtml(t.card)
      : `<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:${EMAIL_COLORS.TEXT};">${p}</p>`
  ).join("");
  return renderEmailShell({
    badge: '',
    bodyHtml,
    ctaText: t.cta ? `${t.cta} →` : undefined,
    // Live senders pass the per-email destination (e.g. /agent/<handle>); previews keep the default.
    ctaUrl: t.cta ? (t.ctaUrl || 'https://verigent.ai') : undefined,
  });
}
