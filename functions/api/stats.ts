// GET /api/stats — Platform health + usage stats (for monitoring)

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = context.env.DB;
  const today = new Date().toISOString().split('T')[0];

  const [agents, runs, completedRuns, freeToday, recentAgents, recentRuns, activeRuns, recentlyCompleted] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM agents').first() as any,
    db.prepare('SELECT COUNT(*) as count FROM runs').first() as any,
    db.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'completed'").first() as any,
    db.prepare("SELECT COUNT(*) as count FROM runs WHERE is_free = 1 AND started_at >= ? || 'T00:00:00Z'").bind(today).first() as any,
    db.prepare("SELECT agent_id, handle, display_name, created_at FROM agents ORDER BY created_at DESC LIMIT 5").all(),
    db.prepare("SELECT run_token, agent_id, status, is_free, started_at FROM runs ORDER BY started_at DESC LIMIT 5").all(),
    db.prepare(`SELECT r.run_token, r.agent_id, r.status, r.started_at, a.display_name
      FROM runs r JOIN agents a ON r.agent_id = a.agent_id
      WHERE r.status IN ('open', 'in_progress', 'grading', 'eval_pending')
      ORDER BY r.started_at DESC LIMIT 10`).all(),
    db.prepare(`SELECT r.run_token, r.agent_id, r.status, r.composite_score, r.tier, r.completed_at, a.display_name
      FROM runs r JOIN agents a ON r.agent_id = a.agent_id
      WHERE r.status = 'completed' AND r.completed_at >= datetime('now', '-1 hour')
      ORDER BY r.completed_at DESC LIMIT 10`).all(),
  ]);

  return Response.json({
    timestamp: new Date().toISOString(),
    totals: {
      agents: agents?.count ?? 0,
      runs: runs?.count ?? 0,
      completed: completedRuns?.count ?? 0,
    },
    daily: {
      free_tests_used: freeToday?.count ?? 0,
      free_tests_limit: 10,
      alert: (freeToday?.count ?? 0) >= 8,
    },
    recent_agents: recentAgents?.results ?? [],
    recent_runs: recentRuns?.results ?? [],
    active_runs: activeRuns?.results ?? [],
    recently_completed: recentlyCompleted?.results ?? [],
  });
};
