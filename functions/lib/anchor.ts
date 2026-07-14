// Bitcoin OP_RETURN anchoring via Nightosphere CLN node.
// Two modes, both embed exactly 32 bytes so they fit the node's OP_RETURN policy
// (Bitcoin Knots caps datacarrier at 40 usable bytes):
//   1. Commitment anchoring: the SHA256 commitment hash (32 bytes) directly.
//   2. VG key attestation: SHA256(vg_key) (32 bytes). The human-readable VG key is
//      stored/displayed off-chain; a verifier SHA256's it and matches the on-chain data.

interface AnchorConfig {
  apiUrl: string;
  rune: string;
  // ANCHOR_MODE (staging fleet-sim spec, Layer 0.1): 'live' (default — prod behaviour, absent var
  // included), 'dryrun' (staging default: build + log the OP_RETURN payload, never contact the CLN
  // node, return a fake txid `staging-dryrun-<hash8>` so downstream columns/asserts still populate),
  // 'off' (no anchoring at all). Implemented HERE, centrally, so every caller inherits the gate.
  mode?: string;
}

interface AnchorResult {
  anchored: boolean;
  txid?: string;
  dataHex?: string;  // the 32-byte payload actually written on-chain (hex)
  feeSat?: number;   // on-chain fee paid for this OP_RETURN tx
  error?: string;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function anchorCommitment(
  config: AnchorConfig,
  commitmentHash: string,
  broadcast: boolean = true
): Promise<AnchorResult> {
  if (!/^[a-f0-9]{64}$/i.test(commitmentHash)) {
    return { anchored: false, error: 'Invalid commitment hash — must be 64-char hex (SHA256)' };
  }

  return broadcastOpReturn(config, commitmentHash, broadcast);
}

export async function attestVGKey(
  config: AnchorConfig,
  vgCode: string,
  identityPubkey?: string | null,
  broadcast: boolean = true
): Promise<AnchorResult> {
  // Embed SHA256 of the VG key — bound to the agent's identity pubkey when present —
  // as a 32-byte payload that fits the node's OP_RETURN cap. The raw VG key + pubkey
  // are held off-chain; verifiers recompute the hash and match the on-chain payload.
  // Binding formula: SHA256(vg_key + "|" + pubkey), or SHA256(vg_key) if no identity.
  const preimage = identityPubkey ? `${vgCode}|${identityPubkey}` : vgCode;
  const hex = await sha256Hex(preimage);
  return broadcastOpReturn(config, hex, broadcast);
}

async function broadcastOpReturn(
  config: AnchorConfig,
  hexData: string,
  broadcast: boolean
): Promise<AnchorResult> {
  const mode = config.mode || 'live';
  if (mode === 'off') {
    return { anchored: false, error: 'anchoring disabled (ANCHOR_MODE=off)' };
  }
  if (mode === 'dryrun') {
    // Never touches the node — staging can hold the PROD CLN_API_URL and still not broadcast.
    console.log(`[anchor dryrun] OP_RETURN payload (NOT broadcast): ${hexData}`);
    return { anchored: true, txid: `staging-dryrun-${hexData.slice(0, 8)}`, dataHex: hexData, feeSat: 0 };
  }
  try {
    const response = await fetch(`${config.apiUrl}/v1/opreturn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.rune}`,
      },
      body: JSON.stringify({ data: hexData, send: broadcast }),
    });

    if (!response.ok) {
      const err = await response.text();
      return { anchored: false, error: `CLN anchor failed (HTTP ${response.status}): ${err}` };
    }

    const result = await response.json() as any;

    if (result.txid) {
      return { anchored: true, txid: result.txid, dataHex: hexData, feeSat: result.fee_sat ?? undefined };
    }

    return { anchored: false, error: result.error || 'No txid returned' };
  } catch (err: any) {
    return { anchored: false, error: `Anchor request failed: ${err.message}` };
  }
}

export async function anchorBatch(
  config: AnchorConfig,
  merkleRoot: string
): Promise<AnchorResult> {
  return anchorCommitment(config, merkleRoot, true);
}
