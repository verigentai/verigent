// functions/lib/weekly.ts — the weekly publication spine (P1-A of docs/WEEKLY-STANDINGS.md).
//
// Testing runs continuously; the PUBLIC figure only moves on the weekly drop. This module owns the
// ISO-week maths, the idempotent snapshot stamp, and the read shape the report/standings surfaces
// consume. Stamping is LAZY-BUT-FROZEN: the first touch of an agent in a new ISO week (daily debit
// sweep, or a standings/report read) freezes its then-current scores as that week's published row —
// UNIQUE(agent_id, week_id) + INSERT OR IGNORE make every later touch a no-op, so a published number
// can never change mid-week (score-versioning lock: never retro-adjust).

import { computeFreshness } from './freshness';

// ── ISO week utilities ────────────────────────────────────────────────────────
// ISO-8601: weeks start Monday; week 1 contains the year's first Thursday.
export function isoWeekParts(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;               // Mon=1 … Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day);       // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

export function isoWeekId(d: Date = new Date()): string {
  const { year, week } = isoWeekParts(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weekMonday(d: Date = new Date()): Date {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (day - 1));
  return t;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function weekLabel(d: Date = new Date()): string {
  const mon = weekMonday(d);
  return `Week of ${mon.getUTCDate()} ${MONTHS[mon.getUTCMonth()]}`;
}

// week_id → human label ("2026-W27" → "Week of 29 Jun"). Inverse of isoWeekId for stored rows.
export function labelForWeekId(weekId: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) return weekId;
  const year = Number(m[1]), week = Number(m[2]);
  // Jan 4 is always in ISO week 1; walk to that week's Monday, then forward.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mon1 = weekMonday(jan4);
  const mon = new Date(mon1.getTime() + (week - 1) * 7 * 86400000);
  return `Week of ${mon.getUTCDate()} ${MONTHS[mon.getUTCMonth()]}`;
}

// ── Snapshot stamp (idempotent freeze) ────────────────────────────────────────
// Freeze the agent's current certified state as this ISO week's published row. No-op when the week
// is already stamped or the agent has no certified score yet. Safe to call from any surface.
export async function ensureWeeklySnapshot(db: D1Database, agentId: string, now?: Date): Promise<void> {
  // `now` is the sim-clock seam (staging fleet exercise): warped sweeps pass their sim-day so the
  // stamp freezes into the right ISO week. Absent (every prod path) = real now, behaviour unchanged.
  const weekId = isoWeekId(now);

  // Cheap existence probe first — the common case (already stamped) costs one indexed SELECT.
  const existing = await db.prepare(
    'SELECT id FROM weekly_snapshots WHERE agent_id = ? AND week_id = ?'
  ).bind(agentId, weekId).first();
  if (existing) return;

  const agent = await db.prepare(
    `SELECT a.agent_id, a.handle, a.owner_id, a.composite_score, a.current_tier, a.primary_class,
            a.certified_model,
            r.class_scores, r.dimension_scores, r.last_tested_at
     FROM agents a LEFT JOIN registry r ON r.agent_id = a.agent_id
     WHERE a.agent_id = ?`
  ).bind(agentId).first() as any;
  if (!agent || agent.composite_score == null) return; // nothing certified to publish yet

  const latestRun = await db.prepare(
    'SELECT run_token, class_scores, dimension_scores FROM test_history WHERE agent_id = ? ORDER BY completed_at DESC LIMIT 1'
  ).bind(agentId).first() as any;

  // Freeze the per-dimension breakdown from the registry, but fall back to the latest run when the
  // registry row hasn't been populated yet (the snapshot can be stamped by a read that races ahead
  // of registry write — that once froze empty breakdowns while the composite was correct). The
  // composite/tier still come from the agent row; this only fills the DISPLAY breakdown.
  const nonEmptyJson = (j: string | null | undefined): boolean => {
    if (!j) return false;
    const t = j.trim();
    return t.length > 2 && t !== '{}' && t !== '[]';
  };
  const classScores = nonEmptyJson(agent.class_scores) ? agent.class_scores : (latestRun?.class_scores || agent.class_scores || '{}');
  const dimScores = nonEmptyJson(agent.dimension_scores) ? agent.dimension_scores : (latestRun?.dimension_scores || agent.dimension_scores || '{}');

  const fresh = computeFreshness(agent.last_tested_at, { certifiedModel: agent.certified_model, now });

  // battery_version from the emitted seam is a build-time constant on the front-end; here we stamp
  // the manifest's version if present on registry rows in future — 'live' marks a spine-era stamp.
  await db.prepare(
    `INSERT OR IGNORE INTO weekly_snapshots
       (agent_id, handle, owner_id, week_id, composite, tier, primary_class, class_scores,
        dimension_scores, freshness_state, run_token, battery_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    agent.agent_id, agent.handle, agent.owner_id, weekId,
    agent.composite_score, agent.current_tier, agent.primary_class,
    classScores, dimScores,
    fresh.label, latestRun?.run_token || null, 'live',
  ).run();
}

// ── Track record ("continuously verified") ────────────────────────────────────
// The tenure stat: how many CONSECUTIVE ISO weeks (ending at the most recent snapshot) the agent
// has had a published verification, and when that unbroken run began. Weeks are compared via their
// Monday dates (7-day steps), so year boundaries (W52/W53→W01) are handled for free.
export interface TrackRecord {
  weeks_continuous: number;
  verified_since: string | null; // published_at of the streak's first week
}

function mondayForWeekId(weekId: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) return null;
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const mon1 = weekMonday(jan4);
  return new Date(mon1.getTime() + (Number(m[2]) - 1) * 7 * 86400000);
}

// Pure streak walk over newest-first (week_id, published_at) rows — shared by the single-agent
// report path and the batched registry path.
export function streakFromSnapshots(snaps: Array<{ week_id: string; published_at: string | null }>): TrackRecord {
  if (!snaps.length) return { weeks_continuous: 0, verified_since: null };
  let streak = 1;
  let since = snaps[0].published_at || null;
  let prevMon = mondayForWeekId(snaps[0].week_id);
  for (let i = 1; i < snaps.length; i++) {
    const mon = mondayForWeekId(snaps[i].week_id);
    if (!mon || !prevMon || prevMon.getTime() - mon.getTime() !== 7 * 86400000) break;
    streak++;
    since = snaps[i].published_at || since;
    prevMon = mon;
  }
  return { weeks_continuous: streak, verified_since: since };
}

export async function tenureForAgent(db: D1Database, agentId: string): Promise<TrackRecord> {
  const rows = await db.prepare(
    'SELECT week_id, published_at FROM weekly_snapshots WHERE agent_id = ? ORDER BY week_id DESC LIMIT 260'
  ).bind(agentId).all();
  return streakFromSnapshots((rows.results || []) as any[]);
}

// Batched tenure for a page of agents (registry): ONE query for every listed agent's snapshot
// weeks, streaks computed in JS — avoids N+1 D1 subrequests on a 50-row page.
export async function tenureForAgents(db: D1Database, agentIds: string[]): Promise<Map<string, TrackRecord>> {
  const out = new Map<string, TrackRecord>();
  if (!agentIds.length) return out;
  const placeholders = agentIds.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT agent_id, week_id, published_at FROM weekly_snapshots
     WHERE agent_id IN (${placeholders}) ORDER BY agent_id, week_id DESC`
  ).bind(...agentIds).all();
  const byAgent = new Map<string, Array<{ week_id: string; published_at: string | null }>>();
  for (const r of (rows.results || []) as any[]) {
    const list = byAgent.get(r.agent_id) || [];
    list.push({ week_id: r.week_id, published_at: r.published_at });
    byAgent.set(r.agent_id, list);
  }
  for (const id of agentIds) out.set(id, streakFromSnapshots(byAgent.get(id) || []));
  return out;
}

// ── Read shape (matches the front-end WeeklyData contract) ────────────────────
export interface WeeklySnapshotOut {
  week_id: string;
  week_label: string;
  published_at: string | null;
  composite: number | null;
  tier: string | null;
  dimension_scores: Record<string, number>;
  class_scores: Record<string, number>;
  delta_composite: number | null;
  run_token: string | null;
}

export interface WeeklyDataOut {
  published_week: WeeklySnapshotOut | null;
  personal_best: { composite: number; week_id: string; week_label: string } | null;
  is_personal_best: boolean;
  archive: WeeklySnapshotOut[];
}

function parse(json: string | null): Record<string, number> {
  try { return JSON.parse(json || '{}'); } catch { return {}; }
}

export async function weeklyDataForAgent(db: D1Database, agentId: string, limit = 26): Promise<WeeklyDataOut> {
  const rows = await db.prepare(
    `SELECT week_id, composite, tier, class_scores, dimension_scores, run_token, published_at
     FROM weekly_snapshots WHERE agent_id = ? ORDER BY week_id DESC LIMIT ?`
  ).bind(agentId, limit).all();
  const snaps = (rows.results || []) as any[];   // newest-first

  const out: WeeklySnapshotOut[] = snaps.map((s, i) => {
    const prev = snaps[i + 1]; // rows are newest-first, so the previous week is the NEXT row
    return {
      week_id: s.week_id,
      week_label: labelForWeekId(s.week_id),
      published_at: s.published_at || null,
      composite: s.composite != null ? Math.round(s.composite) : null,
      tier: s.tier || null,
      dimension_scores: parse(s.dimension_scores),
      class_scores: parse(s.class_scores),
      delta_composite: prev && prev.composite != null && s.composite != null
        ? Math.round(s.composite) - Math.round(prev.composite)
        : null,
      run_token: s.run_token || null,
    };
  });

  const published = out[0] || null;
  let best: WeeklySnapshotOut | null = null;
  for (const s of out) {
    if (s.composite == null) continue;
    if (!best || s.composite > (best.composite ?? -1)) best = s;
  }

  return {
    published_week: published,
    personal_best: best && best.composite != null
      ? { composite: best.composite, week_id: best.week_id, week_label: best.week_label }
      : null,
    is_personal_best: !!(published && best && published.week_id === best.week_id),
    archive: out.slice(1),
  };
}
