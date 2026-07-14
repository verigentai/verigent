// GET /api/leaderboard — Paginated, searchable leaderboard

import { computeFreshness } from '../lib/freshness';
import { tenureForAgents } from '../lib/weekly';
import { referralStanding } from '../lib/referral-standing';

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '50')));
  const search = url.searchParams.get('search') || '';
  const tierFilter = url.searchParams.get('tier') || '';
  const classFilter = url.searchParams.get('class') || '';
  const offset = (page - 1) * limit;

  const db = context.env.DB;

  let where = 'WHERE listed = 1';
  const params: any[] = [];

  if (search) {
    where += ' AND (handle LIKE ? OR display_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tierFilter) {
    where += ' AND tier = ?';
    params.push(tierFilter);
  }
  if (classFilter) {
    where += ' AND primary_class = ?';
    params.push(classFilter);
  }

  // Count total
  const countResult = await db.prepare(
    `SELECT COUNT(*) as total FROM registry ${where}`
  ).bind(...params).first() as any;
  const total = countResult?.total ?? 0;

  // Fetch page
  const rows = await db.prepare(
    `SELECT agent_id, handle, display_name, suffix, composite_score, tier, primary_class, class_scores, tests_completed, last_tested_at,
            (SELECT verification_status FROM agents WHERE agents.agent_id = registry.agent_id) as verification_status,
            (SELECT dispute_count FROM agents WHERE agents.agent_id = registry.agent_id) as dispute_count,
            (SELECT is_colony_early_bird FROM agents WHERE agents.agent_id = registry.agent_id) as is_founder,
            (SELECT is_public_baseline FROM agents WHERE agents.agent_id = registry.agent_id) as is_public_baseline,
            (SELECT badge FROM agents WHERE agents.agent_id = registry.agent_id) as badge,
            (SELECT COALESCE(last_certified_at, updated_at) FROM agents WHERE agents.agent_id = registry.agent_id) as certified_at
     FROM registry ${where}
     ORDER BY composite_score DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  // Track record (consecutive published weeks) + referral standing for the page's agents —
  // both batched into ONE query each so a 50-row page never fans out into N+1 D1 subrequests.
  const pageIds = ((rows.results || []) as any[]).map((r) => r.agent_id);
  const tenure = await tenureForAgents(db, pageIds);
  const refCounts = new Map<string, number>();
  if (pageIds.length) {
    const ph = pageIds.map(() => '?').join(',');
    const refs = await db.prepare(
      `SELECT a.agent_id, COUNT(r.id) AS active_refs
       FROM agents a JOIN referrals r ON r.referrer_owner_id = a.owner_id AND r.status = 'active'
       WHERE a.agent_id IN (${ph}) GROUP BY a.agent_id`
    ).bind(...pageIds).all();
    for (const row of (refs.results || []) as any[]) refCounts.set(row.agent_id, row.active_refs || 0);
  }

  return Response.json({
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
    entries: (rows.results || []).map((r: any, i: number) => ({
      rank: offset + i + 1,
      agent_id: r.agent_id,
      handle: r.handle,
      suffix: r.suffix || '0a',
      display_name: r.display_name,
      composite: r.composite_score,
      tier: r.tier,
      primary_class: r.primary_class,
      class_scores: JSON.parse(r.class_scores || '{}'),
      tests_completed: r.tests_completed,
      last_tested: r.last_tested_at,
      certified_at: r.certified_at || r.last_tested_at,
      is_founder: !!r.is_founder,
      // Independent baseline: a frontier model Verigent runs through the battery itself as a public
      // reference point (never self-submitted). Additive display flag — the registry pulls these into
      // their own section and excludes them from the main list.
      is_public_baseline: !!r.is_public_baseline,
      // Designation badge ('control' | 'admin' | null) — v45, punchlist item 9.
      badge: r.badge || null,
      verification_status: r.verification_status || 'verified',
      dispute_count: r.dispute_count || 0,
      // Soft-expiry freshness badge: fresh | ageing | stale (age-based, never a hard void).
      freshness: computeFreshness(r.certified_at || r.last_tested_at).state,
      // Tenure: consecutive published weeks — the accrued track-record stat.
      weeks_continuous: tenure.get(r.agent_id)?.weeks_continuous ?? 0,
      // Referral standing (owner-level, overflow-past-credit-cap earns standing not cash).
      active_referrals: refCounts.get(r.agent_id) ?? 0,
      referral_standing: referralStanding(refCounts.get(r.agent_id) ?? 0)?.label ?? null,
    })),
  });
};
