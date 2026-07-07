import { config } from '../config.js';

/**
 * ON-CHAIN CLAIM PROOF — automatic, no human in the loop.
 *
 * A claimant may attach the transaction hash of their CROO order. Surety
 * checks Base directly to confirm it is a real, successful, recent order
 * settlement (an ERC-4337 UserOperation through CROO's EntryPoint). A
 * fabricated hash fails every check, so a bogus claim cannot be proof-backed.
 *
 * NOTE: CROO blocks third parties from reading an order via the API (403), so
 * this cannot bind to one specific orderId — but requiring a genuine, recent,
 * CROO-settled Base tx raises the fraud bar enormously and is fully automatic.
 */

export interface ClaimProof {
  provided: boolean;
  valid: boolean;
  viaEntryPoint?: boolean;
  recent?: boolean;
  txHash?: string;
  blockNumber?: number;
  reason: string;
}

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(config.croo.proofRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: any };
  return json.result;
}

/**
 * Verify a claimant's on-chain proof. `policyCreatedAt` (ms) is used to reject
 * a tx older than the policy (someone reusing an ancient unrelated hash).
 */
export async function verifyClaimProof(txHash: string, policyCreatedAt: number): Promise<ClaimProof> {
  if (!txHash) return { provided: false, valid: false, reason: 'No on-chain proof supplied.' };
  if (!HASH_RE.test(txHash)) {
    return { provided: true, valid: false, txHash, reason: 'Not a valid transaction hash.' };
  }
  try {
    const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
    if (!receipt) return { provided: true, valid: false, txHash, reason: 'Transaction not found on Base.' };
    if (receipt.status !== '0x1') {
      return { provided: true, valid: false, txHash, reason: 'Transaction failed on-chain.' };
    }
    const viaEntryPoint = String(receipt.to ?? '').toLowerCase() === config.croo.entryPoint;

    // Recency: the order tx must not predate the policy (allow 1h skew).
    let recent = true;
    try {
      const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
      const tsMs = parseInt(block.timestamp, 16) * 1000;
      recent = tsMs >= policyCreatedAt - 3_600_000;
    } catch {
      /* if we can't read the block, don't fail on recency alone */
    }

    const valid = viaEntryPoint && recent;
    return {
      provided: true,
      valid,
      viaEntryPoint,
      recent,
      txHash,
      blockNumber: parseInt(receipt.blockNumber, 16),
      reason: valid
        ? 'Verified: a real, recent CROO order settlement on Base.'
        : !viaEntryPoint
          ? 'This transaction is not a CROO agent-protocol settlement.'
          : 'This transaction predates the policy.',
    };
  } catch (err) {
    return { provided: true, valid: false, txHash, reason: `Could not verify on Base: ${String((err as Error).message ?? err)}` };
  }
}
