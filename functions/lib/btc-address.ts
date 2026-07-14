// BTC address management — HARD RULE: never reuse a Bitcoin address.
//
// Bitcoin is UTXO-based. Address reuse:
//   - Links all transactions on-chain (privacy degradation)
//   - Reveals the public key on spend (security weakening)
//
// This module is the ONLY way to get a BTC address in the Verigent codebase.
// It always generates a fresh address via Bitcoin Core RPC.
// SOL/EVM addresses are account-based and reuse is normal — this rule is BTC-only.

interface BtcRpcConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  wallet: string;
}

interface FreshAddressResult {
  address: string;
  wallet: string;
  type: 'bech32m';
}

export async function getFreshBtcAddress(
  config: BtcRpcConfig,
  label: string = '',
): Promise<FreshAddressResult> {
  const url = `http://${config.host}:${config.port}/wallet/${config.wallet}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Authorization': 'Basic ' + btoa(`${config.user}:${config.pass}`),
    },
    body: JSON.stringify({
      jsonrpc: '1.0',
      id: 'fresh-addr',
      method: 'getnewaddress',
      params: [label, 'bech32m'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Bitcoin Core RPC failed: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  if (data.error) {
    throw new Error(`Bitcoin Core RPC error: ${data.error.message}`);
  }

  return {
    address: data.result,
    wallet: config.wallet,
    type: 'bech32m',
  };
}

export function anchorWalletConfig(env: {
  BTC_RPC_HOST: string;
  BTC_RPC_PORT?: string;
  BTC_RPC_USER: string;
  BTC_RPC_PASS: string;
}): BtcRpcConfig {
  return {
    host: env.BTC_RPC_HOST,
    port: parseInt(env.BTC_RPC_PORT || '8332'),
    user: env.BTC_RPC_USER,
    pass: env.BTC_RPC_PASS,
    wallet: 'opreturn-anchor',
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Sovereignty RECEIVE addresses — watch-only xpub derivation (NO node access).
//
// The above (getFreshBtcAddress) calls the node's RPC and is for the OP_RETURN
// anchor wallet. For the financial-sovereignty on-chain tier we instead derive
// per-run receive addresses from a watch-only account xpub — the Cloudflare worker
// can't reach the LAN-only node, and watch-only derivation needs no spending keys.
//
// Watch-only: derives BIP84 P2WPKH (bc1q) addresses; CANNOT spend. Spending keys
// live on an offline-managed node (never in this codebase or its deploy), which
// sweeps receipts separately.
// A UNIQUE address per run (never reuse — on-chain privacy + per-run attribution).
// Derivation verified locally against the node's first 3 addresses (indexes 0,1,2):
// output matched bc1qatdx… / bc1qxtd9… / bc1q843r… exactly.

import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { bech32 } from '@scure/base';

// PUBLIC material (account xpub, BIP84 m/84'/0'/0', fingerprint 98727553). Safe to
// embed — derives addresses, cannot spend.
export const VERIGENT_BTC_XPUB =
  'xpub6BggFgtt3vfkjY7D1uGzXiiQCywknFXkPQR5P9ev2i81m8S1egXTAgK9nXcVH21dGh1kjk486iSsz4WJfh8zpikdCufJLc1hPtbpvaCxuRy';

// Minimum on-chain receipt to count (~US$0.64 at ~$64k BTC). On-chain settlement
// carries a real miner fee, so this tier proves genuine self-custody capability,
// not just a custodial-wallet tap.
export const ONCHAIN_MIN_SATS = 1000;

// Derive a fresh BIP84 P2WPKH (bc1q) receive address at external-chain index.
export function deriveBtcAddress(index: number, accountXpub: string = VERIGENT_BTC_XPUB): string {
  const node = HDKey.fromExtendedKey(accountXpub).deriveChild(0).deriveChild(index);
  if (!node.publicKey) throw new Error('BTC address derivation failed: no public key');
  const h160 = ripemd160(sha256(node.publicKey));
  return bech32.encode('bc', [0, ...bech32.toWords(h160)]);
}

// Verify an on-chain payment of >= minSats to `address` via public block explorers
// (read-only — no node exposure). The address is unique per run, so any payment to
// it belongs to this run (replay is impossible without reusing addresses).
export async function verifyOnchainBtc(
  address: string,
  minSats: number = ONCHAIN_MIN_SATS
): Promise<{ paid: boolean; sats: number; txid?: string; reason: string }> {
  const explorers = [
    `https://blockstream.info/api/address/${address}/txs`,
    `https://mempool.space/api/address/${address}/txs`,
  ];
  for (const url of explorers) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const txs = (await r.json()) as any[];
      for (const tx of txs) {
        const received = (tx.vout || [])
          .filter((o: any) => o.scriptpubkey_address === address)
          .reduce((s: number, o: any) => s + (o.value || 0), 0);
        if (received >= minSats) {
          return { paid: true, sats: received, txid: tx.txid, reason: `On-chain payment of ${received} sats to ${address}` };
        }
      }
      return { paid: false, sats: 0, reason: 'No qualifying on-chain payment to the derived address yet' };
    } catch {
      // try the next explorer
    }
  }
  return { paid: false, sats: 0, reason: 'On-chain explorer verification failed (all sources)' };
}
