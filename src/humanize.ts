import type { Policy } from './core/policy.js';

/**
 * HUMAN-READABLE DELIVERY REPORTS.
 *
 * Every deliverable leads with a clean, monospace-aligned `summary` report —
 * scannable at a glance in the CROO "View JSON" panel, like a printed
 * certificate. Machine-readable fields stay on the object below it.
 */

const W = 52; // report width
const LW = 15; // label column width
const HEAVY = '='.repeat(W);
const THIN = '-'.repeat(W);

/** "Label        value" with an aligned label column. */
function row(label: string, value: string | number): string {
  return label.padEnd(LW) + String(value);
}

/** A 10-segment text meter, e.g. 80% -> ████████░░ */
function bar(pct: number): string {
  const filled = Math.max(0, Math.min(10, Math.round((pct / 100) * 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/** Wrap free text to the report width, indented. */
function wrap(text: string, indent = ''): string[] {
  const out: string[] = [];
  let line = indent;
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trimEnd().length > W && line.trim()) {
      out.push(line.trimEnd());
      line = indent + word;
    } else {
      line = line.trim() === '' ? indent + word : line + ' ' + word;
    }
  }
  if (line.trim()) out.push(line.trimEnd());
  return out;
}

/** A real on-chain tx link (the sim rail uses 0xsim… which we skip). */
function txUrl(txHash?: string): string {
  if (!txHash || txHash.startsWith('0xsim') || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return '';
  return `https://basescan.org/tx/${txHash}`;
}

const money = (n: number) => `$${(+n).toFixed(Math.abs(+n) < 1 ? 3 : 2)}`;

/**
 * Turn a rich result object into the delivered text. Leads with the clean
 * monospace report (`summary`) — which CROO renders as an aligned plain-text
 * card, exactly like other agents — then appends a compact one-line JSON for
 * machine consumers. Because it starts with letters (not `{`), CROO shows the
 * readable report, not an escaped JSON blob.
 */
export function formatDeliverable(result: unknown): string {
  if (result && typeof result === 'object' && typeof (result as { summary?: unknown }).summary === 'string') {
    const { summary, ...rest } = result as Record<string, unknown>;
    return `${summary}\n\n${THIN}\nmachine-readable JSON:\n${JSON.stringify(rest)}`;
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}

// ---------------------------------------------------------------- POLICY -----

export function policySummary(
  policy: Policy,
  trustFrom?: string,
  tierInfo?: { tier: string; insuredValue: number; underinsured: boolean },
): string {
  const lines = [
    'SURETY — DELIVERY INSURANCE POLICY',
    HEAVY,
    row('Policy ID', policy.policyId),
    row('Status', 'ACTIVE'),
  ];
  if (tierInfo) lines.push(row('Tier', tierInfo.tier));
  lines.push(row('Insured hire', policy.insuredServiceName));
  if (tierInfo && tierInfo.insuredValue > 0) lines.push(row('Hire value', money(tierInfo.insuredValue)));
  lines.push(
    THIN,
    row('Premium paid', `${money(policy.premium)} USDC`),
    row('Coverage', `up to ${money(policy.coverage)} USDC`),
    row('Risk rating', `${policy.riskScore}/100  ${policy.riskBand.padEnd(6)} ${bar(policy.riskScore)}`),
    row('Valid until', new Date(policy.expiresAt).toUTCString()),
    HEAVY,
  );

  if (tierInfo?.underinsured) {
    lines.push('!  UNDER-INSURED');
    lines.push(
      ...wrap(
        `Your ${money(tierInfo.insuredValue)} hire exceeds the ${tierInfo.tier} cap (${money(policy.coverage)}). Buy the Plus or Pro tier for full coverage.`,
        '   ',
      ),
      '',
    );
  }

  lines.push('HOW TO CLAIM');
  lines.push(
    ...wrap(
      'If the delivery fails, buy "File a Claim" with this policyId and the output you received. An independent verifier judges it; approved claims refund in USDC automatically.',
      '   ',
    ),
  );
  if (trustFrom) {
    lines.push('', ...wrap(`Risk priced with a trust report bought from ${trustFrom}.`));
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------- CLAIM -----

export function claimSummary(opts: {
  claimId?: string;
  policyId?: string;
  approved: boolean;
  verdict: string;
  confidence: number;
  refundUsdc: number;
  refundStatus: string;
  via?: string | null;
  txHash?: string;
  verifierName?: string | null;
  proof?: { provided: boolean; valid: boolean; txHash?: string; reason: string } | null;
}): string {
  const lines = ['SURETY — CLAIM ADJUDICATION', HEAVY];
  if (opts.claimId) lines.push(row('Claim ID', opts.claimId));
  if (opts.policyId) lines.push(row('Policy', opts.policyId));
  lines.push(
    row('Verdict', opts.verdict.toUpperCase()),
    row('Confidence', `${Math.round((opts.confidence ?? 0) * 100)}%  ${bar((opts.confidence ?? 0) * 100)}`),
    THIN,
  );

  if (opts.approved) {
    lines.push(
      row('Decision', 'CLAIM APPROVED'),
      row('Refund', `${money(opts.refundUsdc)} USDC  (${opts.refundStatus}${opts.via ? ` via ${opts.via}` : ''})`),
    );
    const url = txUrl(opts.txHash);
    if (url) lines.push(row('Receipt', url));
    else lines.push(row('Receipt', 'queued — on-chain receipt to follow'));
  } else {
    lines.push(
      row('Decision', 'CLAIM DENIED'),
      row('Reason', opts.verdict === 'satisfied' ? 'delivery met the requirements' : 'inconclusive / unverified evidence'),
    );
  }

  if (opts.verifierName) lines.push(row('Verifier', opts.verifierName));
  if (opts.proof?.provided) {
    lines.push(row('On-chain proof', opts.proof.valid ? 'VERIFIED — real CROO order on Base' : `FAILED — ${opts.proof.reason}`));
    const purl = txUrl(opts.proof.txHash);
    if (opts.proof.valid && purl) lines.push(row('Proof tx', purl));
  }
  lines.push(HEAVY);
  lines.push(
    ...wrap('Judged independently by an agent hired from another team — never the agent whose work is disputed.'),
  );
  return lines.join('\n');
}

// ----------------------------------------------------------- CERTIFICATE -----

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
  const lines = [
    'SURETY — AGENT RISK CERTIFICATE',
    HEAVY,
    row('Service', opts.serviceName ?? opts.serviceId),
    row('Service ID', opts.serviceId),
    row('Risk score', `${opts.riskScore}/100  ${opts.riskBand.padEnd(6)} ${bar(opts.riskScore)}`),
    THIN,
    ...wrap(opts.analystNote.replace(/\s+/g, ' ').trim()),
    THIN,
    'INDICATIVE INSURANCE TERMS',
    row('   Premium', `${money(opts.premiumUsdc)} USDC`),
    row('   Coverage', `up to ${money(opts.coverageUsdc)} USDC`),
    THIN,
  ];
  if (opts.trustFrom) lines.push(row('Trust data', opts.trustFrom));
  lines.push(row('Issued', new Date().toUTCString()), HEAVY);
  return lines.join('\n');
}
