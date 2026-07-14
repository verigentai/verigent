// GET /api/models — the public model registry for the VG key's MODEL segment.
// The registry + helpers LIVE in functions/lib/vgcode.ts (the canonical VG-key file, one owner
// per fact); this endpoint just serves them. Re-exported for any legacy importer.

import { MODEL_REGISTRY } from '../lib/vgcode';
export { MODEL_REGISTRY, shortModelLabel, lookupModelCode } from '../lib/vgcode';

export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (code) {
    const entry = MODEL_REGISTRY[code];
    if (!entry) {
      return Response.json({ error: 'Unknown model code' }, { status: 404 });
    }
    return Response.json({ code, ...entry });
  }

  return Response.json({ models: MODEL_REGISTRY });
};
