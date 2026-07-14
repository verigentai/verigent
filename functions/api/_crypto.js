// Shared crypto utilities for commit-reveal and Merkle tree operations.
// Used by manifest, run, tasks, reveal, and the window rotation script.

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildMerkleTree(leaves) {
  if (leaves.length === 0) return { root: null, paths: {} };

  const hashed = await Promise.all(leaves.map((l) => sha256(l)));
  const n = hashed.length;
  const paths = {};

  // Build tree bottom-up
  let level = [...hashed];
  const tree = [level];

  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left; // duplicate last if odd
      next.push(await sha256(left + right));
    }
    tree.push(next);
    level = next;
  }

  const root = level[0];

  // Build inclusion paths for each leaf
  for (let leafIdx = 0; leafIdx < n; leafIdx++) {
    const path = [];
    let idx = leafIdx;
    for (let lvl = 0; lvl < tree.length - 1; lvl++) {
      const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (sibling < tree[lvl].length) {
        path.push({ hash: tree[lvl][sibling], position: idx % 2 === 0 ? "right" : "left" });
      }
      idx = Math.floor(idx / 2);
    }
    paths[leafIdx] = path;
  }

  return { root, paths, hashed };
}

export async function verifyMerklePath(leafHash, path, root) {
  let current = leafHash;
  for (const step of path) {
    if (step.position === "right") {
      current = await sha256(current + step.hash);
    } else {
      current = await sha256(step.hash + current);
    }
  }
  return current === root;
}

export async function computeContentCommitment(taskpool, grader, salt) {
  const serialized = JSON.stringify(taskpool) + "||" + JSON.stringify(grader) + "||" + salt;
  return sha256(serialized);
}

export async function computeTaskLeaf(task, salt) {
  return sha256(JSON.stringify(task) + "||" + salt);
}

export function generateSalt() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deriveJointSeed(serverSeed, clientNonce) {
  return sha256(serverSeed + "||" + clientNonce);
}

// Un-grindable task-selection seed (M2, audit 2026-07-02). The agent picks clientNonce, but the
// seed also folds in a per-run selectionSalt that is SECRET until the run completes (revealed via
// /api/reveal). So the agent cannot grind clientNonce toward a favourable task draw — it can't
// predict the seed without the salt. serverSeed (the drand beacon) stays in the mix as the
// "server didn't precompute" anchor. Post-grade, salt + nonce + beacon are all public, so anyone
// can recompute the seed and check the draw — verifiable without trusting us (Constitution §2.2).
export async function deriveSelectionSeed(serverSeed, clientNonce, selectionSalt) {
  return sha256(serverSeed + "||" + clientNonce + "||" + selectionSalt);
}
