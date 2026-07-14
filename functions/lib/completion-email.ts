// Shared result-email send for run completion (5m). Called by BOTH the normal eval-completion path
// (recalculateComposite in eval-turn.ts) AND the sweep abandoned→completed path (sweep-expired.ts),
// so a real customer whose run finishes via the sweep still gets their result email — the sweep
// path used to skip it (flagged in 5f/5j).
//
// Idempotent: an atomic UPDATE claims result_email_sent, so the email sends AT MOST ONCE regardless
// of which path reaches completion or how many times the client polls. A genuine send failure rolls
// the flag back so a later pass can retry (Resend accepted == ok:true → no rollback → no double-send).

import { sendResultEmail } from './email';
import { mailerFromEnv } from './email-send';
import { startFreeContinuousWindow } from './wallet';

interface CompletionEmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_CAPTURE?: string;
  DB?: D1Database;
}

export async function sendCompletionEmail(
  db: D1Database, env: CompletionEmailEnv, runToken: string
): Promise<{ sent: boolean; reason?: string }> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'no RESEND_API_KEY' };

  const run = await db.prepare('SELECT * FROM runs WHERE run_token = ?').bind(runToken).first() as any;
  if (!run) return { sent: false, reason: 'run not found' };
  const agent = await db.prepare('SELECT * FROM agents WHERE agent_id = ?').bind(run.agent_id).first() as any;

  const to = run.email || agent?.email;
  if (!to) return { sent: false, reason: 'no recipient' };

  // Atomic claim — at most one send across the normal path, the sweep, and repeated polls.
  const claim = await db.prepare(
    "UPDATE runs SET result_email_sent = 1 WHERE run_token = ? AND result_email_sent = 0"
  ).bind(runToken).run();
  if (!claim.meta.changes) return { sent: false, reason: 'already sent' };

  let dimensionScores: Record<string, number> = {};
  let classScores: Record<string, number> = {};
  try { dimensionScores = JSON.parse(run.dimension_scores || '{}'); } catch { /* empty */ }
  try { classScores = JSON.parse(run.class_scores || '{}'); } catch { /* empty */ }

  // Arm the free continuous window HERE — before the email builds — so the result email always
  // carries the probe-pull setup prompt on the run that earned it (72h standard / 7d referred,
  // Ant ruling 2026-07-08). Self-guarded + idempotent (free_until IS NULL), covers BOTH completion
  // paths (eval + sweep). Best-effort: a failure never blocks the result email.
  let freeWindow: { hours?: number; days?: number; setup_paste: string } | undefined;
  try {
    const w = await startFreeContinuousWindow(db, run.agent_id);
    if (w.ok && w.setup_agent_paste) {
      freeWindow = { hours: w.free_hours, days: w.free_days, setup_paste: w.setup_agent_paste };
    }
  } catch { /* perk, not a gate */ }

  const res = await sendResultEmail({
    to,
    agentHandle: agent?.handle,
    displayName: agent?.display_name,
    vgCode: agent?.vg_code,
    tier: run.tier,
    composite: run.composite_score,
    dimensionScores,
    classScores,
    primaryClass: run.primary_class,
    runToken,
    isFree: !!run.is_free,
    couponCode: run.coupon_code || undefined,
    freeWindow,
  }, mailerFromEnv(env)).catch(() => ({ ok: false }));

  // Roll the claim back only if the email was NOT accepted, so a retry can re-attempt without
  // risking a double-send (Resend accepted → ok:true → flag stays set).
  if (!res || !(res as any).ok) {
    await db.prepare("UPDATE runs SET result_email_sent = 0 WHERE run_token = ? AND result_email_sent = 1").bind(runToken).run();
    return { sent: false, reason: 'send failed' };
  }
  return { sent: true };
}
