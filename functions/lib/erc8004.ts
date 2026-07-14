// functions/lib/erc8004.ts
// ERC-8004 (Trustless Agents) — EVM/Base attestation path for Verigent capability credentials.
//
// Dual-rail design (set with Ant 2026-06-19):
//   Bitcoin OP_RETURN (see anchor.ts) = the PERMANENCE root — durable, neutral, sovereign.
//   ERC-8004 on Base                  = the DISCOVERABILITY layer — agents read the capability
//                                       score at transaction time, plugged into the standard
//                                       everyone's converging on.
// The link between the two rails is `responseHash`: it carries the SAME 32-byte SHA256 that
// anchor.ts writes to Bitcoin. One field => "Bitcoin-anchored, Base-discoverable".
//
// STATUS (grounded 2026-06-19, verified against eips.ethereum.org/EIPS/eip-8004 and
// github.com/erc-8004/erc-8004-contracts):
//   - Identity & Reputation registries are LIVE on Base mainnet (addresses below).
//   - The VALIDATION REGISTRY (our ideal home for a 0-100 capability score) is "still under
//     active update and discussion" — NOT yet deployed to mainnet. So the signed on-chain WRITE
//     is gated until: (1) the Validation Registry deploys on Base, (2) an EVM signer (viem) is
//     added, (3) a funded Base validator wallet is provisioned.
//   - The pure mapping + Bitcoin<->Base hash linkage below are FINAL and unit-testable today.
// See go-to-market/erc8004-build-status.md for the full design + sequencing.

// --- verified deployed addresses (github.com/erc-8004/erc-8004-contracts) ---
export const ERC8004_BASE = {
  chainId: 8453, // Base mainnet (eip155:8453) — where the x402 agents already transact
  identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  validationRegistry: null as string | null, // PENDING deployment
} as const;

// --- verified Validation Registry interface (EIP-8004) ---
// Kept as human-readable signatures; the 4-byte selectors are derived via keccak by the EVM lib
// (viem) at call time — NOT hand-computed here, to avoid shipping unverified selectors.
export const VALIDATION_REGISTRY_ABI = [
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
  "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
  "function getSummary(uint256 agentId, address[] validatorAddresses, string tag) view returns (uint64 count, uint8 averageResponse)",
] as const;

// Distinguishes a Verigent CAPABILITY score from e.g. ERC-8126 security/risk scores on the same registry.
export const VG_VALIDATION_TAG = "capability";

// --- the core mapping (FINAL, chain-agnostic, testable today) ---------------
export interface VgkValidationEntry {
  agentId: string; // ERC-8004 agent id (from the Identity Registry), decimal string
  response: number; // uint8 0-100 capability score (the VGK grade)
  responseURI: string; // off-chain full report URL
  responseHash: string; // 0x + 64hex — the SAME hash anchored on Bitcoin (cross-rail link)
  tag: string; // VG_VALIDATION_TAG
}

const HEX32 = /^0x[a-f0-9]{64}$/i;

/**
 * Map a Verigent grade (0-100) + the Bitcoin-anchored commitment into an ERC-8004
 * validation entry. `btcAnchorHashHex` is the 32-byte SHA256 that anchor.ts already
 * wrote to Bitcoin OP_RETURN, so the Base entry and the BTC anchor commit to the same proof.
 */
export function gradeToValidationEntry(opts: {
  agentId: string;
  grade: number;
  reportUrl: string;
  btcAnchorHashHex: string;
}): VgkValidationEntry {
  const response = Math.max(0, Math.min(100, Math.round(opts.grade))); // clamp into uint8 0-100
  const hash = opts.btcAnchorHashHex.startsWith("0x")
    ? opts.btcAnchorHashHex
    : "0x" + opts.btcAnchorHashHex;
  if (!HEX32.test(hash)) {
    throw new Error("btcAnchorHashHex must be a 32-byte hex string (the Bitcoin-anchored SHA256)");
  }
  if (!/^\d+$/.test(opts.agentId)) {
    throw new Error("agentId must be a decimal string (ERC-8004 Identity Registry token id)");
  }
  return {
    agentId: opts.agentId,
    response,
    responseURI: opts.reportUrl,
    responseHash: hash,
    tag: VG_VALIDATION_TAG,
  };
}

// --- write path (viem-wired; gated only by registry deployment) --------------
import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

export interface Erc8004Config {
  rpcUrl: string; // Base mainnet RPC
  validatorPrivKey: string; // Verigent's Base validator key (env-injected)
  validationRegistry: string; // deployed address (once available)
}

export interface Erc8004Result {
  written: boolean;
  txHash?: string;
  entry?: VgkValidationEntry;
  error?: string;
}

/**
 * Submit a capability score to the ERC-8004 Validation Registry on Base.
 * BLOCKED until the Validation Registry is deployed and an EVM signer (viem) is wired.
 * Returns a result object (never throws) to match anchor.ts conventions.
 */
export async function writeValidationResponse(
  config: Erc8004Config,
  requestHash: string,
  entry: VgkValidationEntry
): Promise<Erc8004Result> {
  const registry = config.validationRegistry || ERC8004_BASE.validationRegistry;
  if (!registry) {
    return {
      written: false,
      entry,
      error:
        "ERC-8004 Validation Registry not yet deployed on Base. " +
        "Identity/Reputation registries are live; capability-score writes are gated until deployment. " +
        "The watcher (verigent-erc8004-watch.sh) will alert when it's live. See erc8004-build-status.md.",
    };
  }
  try {
    const account = privateKeyToAccount(config.validatorPrivKey as `0x${string}`);
    const wallet = createWalletClient({ account, chain: base, transport: http(config.rpcUrl) });
    const txHash = await wallet.writeContract({
      address: registry as `0x${string}`,
      abi: parseAbi(VALIDATION_REGISTRY_ABI as unknown as string[]),
      functionName: "validationResponse",
      args: [
        requestHash as `0x${string}`,
        entry.response,
        entry.responseURI,
        entry.responseHash as `0x${string}`,
        entry.tag,
      ],
    });
    return { written: true, txHash, entry };
  } catch (err: any) {
    return { written: false, entry, error: `validationResponse write failed: ${err.message}` };
  }
}
