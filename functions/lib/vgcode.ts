// VG KEY — THE CANONICAL FILE (single source of truth for the credential format).
//
// Everything about the VG key's structure lives HERE: the format, the field definitions, the
// model short-form registry, the builder (generateVGCode) and the parser (parseVGCode).
// Other surfaces (agents.txt §10, llms.txt, /api/models, report pages) DERIVE from this file —
// never restate the format elsewhere (Constitution §2.10: one owner per fact).
//
// Format: VG:{name}-{suffix}:{tier}-{PRIMARY}-{MODEL}-{YYMMDD}.{class_scores}
// Example: VG:JARVIS-0A:V3-ARCH-Opus4.8-260615.Se4Op7An5Ar9Co2Ad6St8Sc3Sa5So1Tr2Fo6
//
// - VG:            namespace (Verigent)
// - name-suffix    agent's unique handle (uppercase, max 20 chars; suffix assigned at registry)
// - tier           V1–V6 (capability)
// - PRIMARY        4-letter primary class code
// - MODEL          underlying model at test time, in registry short form (spaces/hyphens
//                  stripped, single token — e.g. Opus4.8, GPT5.5, Gemini2.5Pro). Reinstated by
//                  Ant 2026-07-08 (a key must say what stack earned it); "Unknown" when the run
//                  declared no model. Registry below; published at /api/models.
// - YYMMDD         year+month+day of verification
// - .              separator (ASCII, 1 byte)
// - class_scores   12 × (2-letter class code + single digit 0–9)
//                  Digit = floor(class_score / 10), capped at 9
//                  Fixed order: Se Op An Ar Co Ad St Sc Sa So Tr Fo
//
// Keys minted before 2026-07-08 have no MODEL segment; parseVGCode accepts both shapes
// (scores are never rewritten — Constitution §2.4 — so old keys must keep parsing).
//
// No assurance tier in the key (removed 2026-06-24): FRESHNESS — computed separately
// (freshness.ts) — is the live "is it current / continuously verified" signal. Model
// swap-detection uses the private model_fingerprint_hash; the public MODEL segment is the
// declared-and-verified stack at test time, not the swap detector.

// ── Model registry (SoT — /api/models serves this verbatim) ──
// Keyed by the legacy 2-letter code (still the /api/models?code= lookup key); the VG key itself
// carries the SHORT FORM derived by shortModelLabel(). Short forms are permanent — once assigned,
// a short form always refers to the same model version.
export const MODEL_REGISTRY: Record<string, { model: string; provider: string }> = {
  Ku: { model: 'Claude Opus 4.8', provider: 'Anthropic' },
  Ra: { model: 'Claude Opus 4.6', provider: 'Anthropic' },
  Ve: { model: 'Claude Sonnet 4.6', provider: 'Anthropic' },
  Ji: { model: 'Claude Haiku 4.5', provider: 'Anthropic' },
  Ga: { model: 'Claude Fable 5', provider: 'Anthropic' },
  Bo: { model: 'GPT-5.5', provider: 'OpenAI' },
  Ne: { model: 'GPT-5.4', provider: 'OpenAI' },
  Fu: { model: 'GPT-4o', provider: 'OpenAI' },
  Da: { model: 'Gemini 2.5 Pro', provider: 'Google' },
  Lo: { model: 'Gemini 2.5 Flash', provider: 'Google' },
  Tu: { model: 'Grok 4.3', provider: 'xAI' },
  Wi: { model: 'DeepSeek V3.1', provider: 'DeepSeek' },
  Ma: { model: 'DeepSeek V3.2', provider: 'DeepSeek' },
  Zo: { model: 'Llama 3.3 70B', provider: 'Meta' },
  Hi: { model: 'Qwen 2.5 72B', provider: 'Alibaba' },
  Pe: { model: 'Mistral Large', provider: 'Mistral' },
};

// Short, human-readable model label for the VG key (e.g. "Claude Opus 4.8" → "Opus4.8").
// Drops the "Claude" vendor prefix (Opus/Sonnet/Haiku/Fable are distinctive) and strips
// spaces/hyphens so the label is a single token (hyphen is the VG-key field separator).
// Canonicalises against the registry when recognised, else sanitises the declared name.
export function shortModelLabel(modelName: string): string {
  if (!modelName) return 'Unknown';
  const code = lookupModelCode(modelName);
  const canonical = code !== 'XX' ? MODEL_REGISTRY[code].model : modelName;
  // Strip to the key-safe charset [A-Za-z0-9.] — hyphen is the VG-key field separator and anything
  // else (underscore, slash) would make the minted key unparseable by parseVGCode's MODEL group.
  const label = canonical.trim().replace(/^claude\s+/i, '').replace(/[^A-Za-z0-9.]+/g, '').slice(0, 16);
  return label || 'Unknown';
}

export function lookupModelCode(modelName: string): string {
  if (!modelName) return 'XX';
  const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ').replace(/(\d) (\d)/g, '$1.$2').trim();
  const input = norm(modelName);
  // Exact normalised match first, then two-way containment ("claude-opus-4-6" → "Claude Opus 4.6").
  // BOTH sides are normalised the same way. The old "input contains the entry's LAST WORD" shortcut
  // is gone — 'Claude Fable 5' ends in "5", so ANY name containing a 5 (Gemini 2.5 Pro, GPT-5.5)
  // matched Fable 5 first (caught minting the MODEL segment, 2026-07-08).
  for (const [code, entry] of Object.entries(MODEL_REGISTRY)) {
    if (norm(entry.model) === input) return code;
  }
  for (const [code, entry] of Object.entries(MODEL_REGISTRY)) {
    const entryNorm = norm(entry.model);
    if (input.includes(entryNorm) || entryNorm.includes(input)) return code;
  }
  return 'XX';
}

const CLASS_ORDER = [
  'sentinel', 'operative', 'analyst', 'architect', 'conduit', 'adaptor',
  'steward', 'scout', 'sage', 'sovereign', 'trader', 'forge',
] as const;

const CLASS_SHORT: Record<string, string> = {
  sentinel: 'Se', operative: 'Op', analyst: 'An', architect: 'Ar',
  conduit: 'Co', adaptor: 'Ad', steward: 'St', scout: 'Sc',
  sage: 'Sa', sovereign: 'So', trader: 'Tr', forge: 'Fo',
};

const CLASS_PRIMARY: Record<string, string> = {
  Sentinel: 'SENT', Operative: 'OPER', Analyst: 'ANLT', Architect: 'ARCH',
  Conduit: 'COND', Adaptor: 'ADPT', Steward: 'STWD', Scout: 'SCOT',
  Sage: 'SAGE', Sovereign: 'SOVR', Trader: 'TRDR', Forge: 'FRGE',
};

export function generateVGCode(
  handle: string,
  tier: string,
  primaryClass: string,
  classScores: Record<string, number>,
  model?: string,
  verifiedAt?: Date,
): string {
  const primaryCode = CLASS_PRIMARY[primaryClass] || 'UNKN';
  const modelCode = shortModelLabel(model || '');
  const d = verifiedAt || new Date();
  const yymmdd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');

  const radarString = CLASS_ORDER.map(key => {
    const score = classScores[key] ?? 0;
    const digit = Math.min(9, Math.floor(score / 10));
    return `${CLASS_SHORT[key]}${digit}`;
  }).join('');

  const safeHandle = handle.toUpperCase().slice(0, 20);
  return `VG:${safeHandle}:${tier}-${primaryCode}-${modelCode}-${yymmdd}.${radarString}`;
}

export function parseVGCode(code: string): {
  valid: boolean;
  handle?: string;
  tier?: string;
  model?: string;
  dateMarker?: string;
  primaryClass?: string;
  classScores?: Record<string, number>;
} {
  // Format: VG:HANDLE:TIER-PRIMARY-MODEL-YYMMDD.scores. The MODEL group is OPTIONAL so keys
  // minted before 2026-07-08 (no model segment) still parse — old scores are never rewritten.
  // The date is always the LAST hyphen-separated field before the radar separator, so a model
  // short form containing digits/dots (Opus4.8, Gemini2.5Pro) can't be confused with it.
  const match = code.match(/^VG:([^:]+):(V\d)-([A-Z]{4})-(?:([A-Za-z0-9.]+)-)?(\d{4,6})[.·](.+)$/);
  if (!match) return { valid: false };

  const [, handle, tier, primaryCode, model, dateMarker, radarStr] = match;

  const primaryName = Object.entries(CLASS_PRIMARY).find(([, v]) => v === primaryCode)?.[0];

  const classScores: Record<string, number> = {};
  const pairs = radarStr.match(/[A-Z][a-z]\d/g);
  if (pairs && pairs.length === 12) {
    const shortToKey = Object.fromEntries(Object.entries(CLASS_SHORT).map(([k, v]) => [v, k]));
    for (const pair of pairs) {
      const short = pair.slice(0, 2);
      const digit = parseInt(pair[2]);
      const key = shortToKey[short];
      if (key) classScores[key] = digit * 10 + 5; // midpoint of bucket
    }
  }

  return { valid: true, handle, tier, model: model || undefined, dateMarker, primaryClass: primaryName, classScores };
}
