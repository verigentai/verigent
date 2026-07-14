// GET /api/badge/{handle}[.svg] — embeddable SVG badge.
//
// Shows the agent's LIVE freshness + assurance glyph, and visibly decays as the cert ages
// (Fresh → Stable → Ageing → Lapsing → Stale, brand tones). Operators paste it on their repo /
// site / listing — every badge in the wild is a backlink + an advert, and it decays unless they
// keep verifying. That's the distribution loop (and the conversion nudge) in one artefact.

import { computeFreshness, TONE } from '../../lib/freshness';

interface Env {
  DB: D1Database;
}

function esc(s: string): string {
  return String(s).replace(/[<>&"]/g, c => (({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as Record<string, string>)[c]));
}

function renderBadge(agent: any): string {
  const left = 'Verigent';
  let stateLabel = 'Unverified';
  let tone = TONE.stale;

  if (agent?.vg_code) {
    const f = computeFreshness(agent.last_certified_at || agent.updated_at || null, { reverifyingUntil: agent.reverifying_until });
    stateLabel = f.label;
    tone = TONE[f.state] || TONE.stale;
  }

  const right = stateLabel;
  const charW = 6.4;
  const padX = 8;
  const lw = Math.round(padX * 2 + left.length * charW);
  const rw = Math.round(padX * 2 + right.length * charW);
  const w = lw + rw;
  const h = 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${esc(left)}: ${esc(right)}">
  <rect width="${w}" height="${h}" rx="4" fill="#1e1b2e"/>
  <rect x="${lw}" width="${rw}" height="${h}" rx="4" fill="${tone}"/>
  <rect x="${lw}" width="6" height="${h}" fill="${tone}"/>
  <g fill="#ffffff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="${(lw / 2).toFixed(1)}" y="14">${esc(left)}</text>
    <text x="${(lw + rw / 2).toFixed(1)}" y="14">${esc(right)}</text>
  </g>
</svg>`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const raw = (context.params.handle as string) || '';
  const handle = raw.replace(/\.svg$/i, '');

  const agent = await context.env.DB.prepare(
    'SELECT handle, vg_code, last_certified_at, updated_at, reverifying_until FROM agents WHERE LOWER(handle) = ?'
  ).bind(handle.toLowerCase()).first() as any;

  return new Response(renderBadge(agent), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Short cache so the badge visibly updates as freshness decays, but not per-request.
      'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
