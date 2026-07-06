import type { Policy } from './core/policy.js';

/**
 * HUMAN-READABLE DELIVERY SUMMARIES.
 *
 * Every deliverable leads with a plain-language `summary` (Markdown) so a
 * customer who opens the raw order JSON understands what they got at a glance.
 * Real on-chain refunds link straight to Basescan. Machine-readable fields
 * stay on the object below the summary for agent consumers.
 */

/** Only link a hash that is a real on-chain tx (the sim rail uses 0xsim…). */
function basescan(txHash?: string): string {
  if (!txHash || txHash.startsWith('0xsim') || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return '';
  return `[view the refund on Basescan](https://basescan.org/tx/${txHash})`;
}

export function policySummary(policy: Policy, trustFrom?: string): string {
  return [
    `# 🛡️ You're covered — policy ${policy.policyId}`,
    '',
    `You're about to hire **${policy.insuredServiceName}**. If its delivery fails an independent check, Surety refunds you up to **$${policy.coverage} USDC**.`,
    '',
    `- **Premium paid:** $${policy.premium}`,
    `- **Coverage:** up to $${policy.coverage} USDC`,
    `- **Risk rating:** ${policy.riskScore}/100 (${policy.riskBand})`,
    `- **Valid until:** ${new Date(policy.expiresAt).toUTCString()}`,
    '',
    '## If the delivery is bad',
    'Buy the **"File a Claim"** service and include this `policyId` plus the output you received. An independent verifier agent (from another team) judges it, and approved claims are refunded to your wallet automatically.',
    trustFrom ? `\n_Risk priced using a trust report bought from **${trustFrom}**._` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function claimSummary(opts: {
  approved: boolean;
  verdict: string;
  confidence: number;
  refundUsdc: number;
  refundStatus: string;
  via?: string | null;
  txHash?: string;
  verifierName?: string | null;
}): string {
  const head = opts.approved
    ? `# ✅ Claim approved — $${opts.refundUsdc} USDC refunded`
    : `# ❌ Claim denied`;

  const lines = [head, ''];

  if (opts.approved) {
    const link = basescan(opts.txHash);
    lines.push(
      `The delivery did **not** meet the agreed requirements, so your coverage was paid out.`,
      '',
      `- **Refund:** $${opts.refundUsdc} USDC (${opts.refundStatus}${opts.via ? ` via ${opts.via}` : ''})`,
      link ? `- **Proof:** ${link}` : '- _Refund is queued; the on-chain receipt will follow._',
    );
  } else {
    lines.push(
      opts.verdict === 'satisfied'
        ? `The delivery **met** the agreed requirements, so no refund is due — the agent did its job.`
        : `The evidence was **inconclusive**, so no automatic refund was issued.`,
    );
  }

  lines.push(
    '',
    `**Verdict:** ${opts.verdict} · **confidence ${Math.round((opts.confidence ?? 0) * 100)}%**`,
    opts.verifierName ? `_Judged independently by **${opts.verifierName}**, hired from another team — never the agent being disputed._` : '',
  );
  return lines.filter((l) => l !== '').join('\n');
}

export function certificateSummary(opts: {
  serviceName: string | null;
  serviceId: string;
  riskScore: number;
  riskBand: string;
  analystNote: string;
  premiumUsdc: number;
  coverageUsdc: number;
  trustFrom?: string | null;
}): string {
  return [
    `# 📊 Risk Certificate — ${opts.serviceName ?? opts.serviceId}`,
    '',
    `**Risk score: ${opts.riskScore}/100 (${opts.riskBand})**`,
    '',
    opts.analystNote,
    '',
    '## If you want to insure a hire of this agent',
    `A **$${opts.premiumUsdc}** premium would buy you up to **$${opts.coverageUsdc} USDC** of coverage.`,
    opts.trustFrom ? `\n_Assessed using a trust report bought from **${opts.trustFrom}**._` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
