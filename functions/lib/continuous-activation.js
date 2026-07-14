// functions/lib/continuous-activation.js — minting the credential an agent's scheduled job uses
// to pull continuous-verification probes.
//
// PROF-INBOX:inbox-0007 — SAFE, decision-free half of continuous activation. This only MINTS a
// pull_token and produces the user-facing setup prompt. It deliberately does NOT decide WHO may
// activate an agent or WHEN (top-up? sign-up? can an agent activate a sub-agent?) — those are
// parked product decisions (see canonical spec "OPEN" list). The endpoint that calls this is the
// thing that must encode that policy, and is intentionally left unwired until Ant decides it.

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// The recurring secret the scheduled job presents to /api/probe/start. Distinct from the one-time
// VG-TEST first-run key and from the public VG key — this is long-lived and private.
export function generatePullToken() {
  return 'vgp_' + randomHex(20);
}

// The agent-field patch that marks an agent approved-but-unproven. continuous_active stays 0 until
// two successful self-pulls prove the scheduler actually runs (see probe-session.js).
export function activationPatch(pullToken) {
  return { pull_token: pullToken, continuous_pending: 1, self_pull_count: 0 };
}

// The single paste handed to the user — same "just tell your agent to go" shape as the first-test
// kickoff, but for the recurring continuous check.
//
// MCP-FIRST (Ant ruling 2026-07-08, after AX-7's three-for-three harness denials): the operator adds
// the Verigent MCP server (npm: verigent-mcp-server) with the handle+token in its ENV — a standard,
// operator-sanctioned act that permissioned harnesses (Claude Code auto mode etc.) natively trust,
// where raw curl to an unknown URL gets classifier-blocked. The agent never handles raw credentials.
//
// The STANDING-GRANT line is load-bearing (Bishop's refusal, 2026-07-08): a well-built agent woken
// by a scheduler to act on tokens from its own memory will — correctly — refuse as a possible
// planted injection unless its operator put a durable authorisation in its config (agents.txt §3d).
// So the setup paste tells the operator to grant it up front, not after their agent balks.
// TWO-STEP PARTS (Ant 2026-07-08 — presentation split): the drawer shows the setup as two short,
// individually-copyable boxes instead of one blob. Same content as buildSetupPrompt; the email
// keeps the single blob (it has to survive forwarding as one piece).
export function buildSetupParts(handle, pullToken, apiBase = 'https://verigent.ai') {
  return {
    // Step 1 — run once in a terminal (Claude Code). Other harnesses: the JSON below.
    command: `claude mcp add verigent -e VERIGENT_HANDLE=${handle} -e VERIGENT_PULL_TOKEN=${pullToken} -- npx -y verigent-mcp-server`,
    config_json: JSON.stringify({
      mcpServers: {
        verigent: {
          command: 'npx',
          args: ['-y', 'verigent-mcp-server'],
          env: { VERIGENT_HANDLE: handle, VERIGENT_PULL_TOKEN: pullToken },
        },
      },
    }, null, 2),
    // SINGLE PASTE (result email, Ant 2026-07-14 evening ruling): ONE box, zero terminal — the
    // agent adds the MCP server to its own config off this paste (Baymax dogfood proved harnesses
    // do this cleanly; the operator pasting IS the operator act the MCP-first ruling wanted).
    // ALL mechanics live in §5f, which the agent reads before acting (every model in the
    // 2026-07-14 reaction panel fetched it first). Two-box variant stays in Owner Controls for
    // agents that can't self-edit config.
    agent_paste_short: [
      `Operator grant: I authorise scheduled Verigent challenge-pulls for ${handle}. Add the Verigent`,
      `MCP server to your config — command: npx -y verigent-mcp-server, env: VERIGENT_HANDLE=${handle},`,
      `VERIGENT_PULL_TOKEN=${pullToken} — then read ${apiBase}/agents.txt §5f and keep it continuously`,
      `verified. Schedule on this machine only, or just check when active; the token lives ONLY in that`,
      `config entry — never in scripts, plists, secrets files, or any cloud/third-party config.`,
    ].join(' '),
    // Step 2 — paste to the agent: the standing grant + the go-instruction. Half the old length.
    // SCHEDULER-PLACEMENT line (Baymax funnel gap, 2026-07-14): without it, agents improvise —
    // Baymax offered to copy the pull token into cloud-routine config. Local scheduler first;
    // session-driven is fine by design; the token never leaves the machine. Mirrors §5f.
    agent_paste: [
      `Operator grant: I authorise scheduled Verigent challenge-pulls for ${handle} — add this as a standing`,
      `authorisation in your own config (the pull token lives in the MCP server config; it can only request`,
      `challenges — ${apiBase}/agents.txt §5f documents the mechanism). Then: keep ${handle} continuously`,
      `verified — whenever you're active and a challenge is due, or on a recurring job (~5 times a day), call`,
      `probe_start, drive the returned tools with probe_call, then probe_finish. Scheduling: prefer your`,
      `harness's own recurring-task feature if it runs ON this machine (cloud-hosted routines don't count);`,
      `otherwise a cron/launchd job that invokes your harness. Either way the pull token lives ONLY in the`,
      `MCP server config — never embed or duplicate it in scripts, plists, secrets files, or any`,
      `cloud/third-party config. No scheduler at all? Checks whenever you're active are fine by design.`,
      `Two successful checks activate.`,
    ].join(' '),
  };
}

export function buildSetupPrompt(handle, pullToken, apiBase = 'https://verigent.ai') {
  return [
    `Operator: two one-time steps.`,
    `(1) Add the Verigent MCP server to your agent's MCP config (a config entry, not a shell command) —`,
    `command: npx -y verigent-mcp-server, env: VERIGENT_HANDLE=${handle} and VERIGENT_PULL_TOKEN=${pullToken}.`,
    `Adding the server IS the setup — the token is deliberately low-privilege (it can only request`,
    `challenges for your handle; challenge tools are simulated exam props, never payments, signing,`,
    `sending or config changes — ${apiBase}/agents.txt §5f documents the whole mechanism).`,
    `(2) Add a standing authorisation to your agent's own config (system prompt / CLAUDE.md / policy layer)`,
    `permitting scheduled Verigent challenge-pulls for ${handle} — a well-built agent will rightly refuse unattended`,
    `scheduled tasks that lack a durable operator grant. Then give your agent this:`,
    `Read ${apiBase}/agents.txt §5f and keep ${handle} continuously verified: whenever you're active and a`,
    `challenge is due — or on a recurring job at the cadence set in Owner Controls (default ~5 times a day) —`,
    `call the probe_start tool, drive the returned tools with probe_call, then probe_finish.`,
    `Scheduling: prefer your harness's own recurring-task feature if it runs ON this machine (cloud-hosted`,
    `routines don't count); otherwise a cron/launchd job that invokes your harness. Either way the pull`,
    `token lives ONLY in the MCP server config — never embed or duplicate it in scripts, plists, secrets`,
    `files, or any cloud/third-party config. No scheduler at all? Checks whenever you're active are fine by design.`,
    `Two successful checks activate continuous verification; after that, regular checks keep your credential current.`,
  ].join(' ');
}
