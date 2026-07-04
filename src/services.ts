import { emit } from './bus.js';
import { llm } from './llm.js';
import { underwrite } from './core/underwrite.js';
import { processClaim } from './core/claims.js';
import {
  bandFor,
  coverageFor,
  createPolicy,
  getPool,
  poolFloat,
  recordPremium,
  round6,
  type Policy,
} from './core/policy.js';
import type { PaymentRail, SoldServiceHandler, SoldServiceKind } from './rail/types.js';

/**
 * THE PRODUCTS — the three services Surety sells on the CROO Agent Store.
 *
 *   insure      "Insure a Hire"        premium in, policy out
 *   claim       "File a Claim"         deliverable in, verdict (+refund) out
 *   certificate "Agent Risk Certificate" serviceId in, underwriting report out
 *
 * Each handler takes the buyer's `requirements` JSON and returns the JSON
 * deliverable. The same handlers power the live dashboard, so the demo and
 * the real on-chain product are literally the same code path.
 */

function field(input: unknown, ...names: string[]): string {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const n of names) {
    const v = obj[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

// ---- Plain-text tolerance ----------------------------------------------
// Buyers on the store often type free text instead of JSON. Every product
// accepts that: ids and wallets are extracted from the text, and a service
// can even be referenced by its NAME (matched against the live store list).

const SERVICE_ID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\b/i;
const POLICY_ID = /\bpol_[0-9a-z]{8}\b/i;
const WALLET = /\b0x[0-9a-fA-F]{40}\b|\b[a-z0-9][a-z0-9-]*\.base\.eth\b/;

function asText(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

/** Find the serviceId in structured fields, raw text, or by service NAME. */
async function resolveServiceId(input: unknown, text: string): Promise<string> {
  const explicit = field(input, 'serviceId', 'insuredServiceId', 'targetServiceId', 'service');
  if (explicit) return explicit;
  const inText = text.match(SERVICE_ID)?.[0];
  if (inText) return inText;
  if (text) {
    try {
      const { getStoreServices } = await import('./store.js');
      const lower = text.toLowerCase();
      const named = (await getStoreServices())
        .filter((s) => s.name.length >= 5 && lower.includes(s.name.toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (named) return named.serviceId;
    } catch {
      /* store unreachable — fall through to the error below */
    }
  }
  return '';
}

function resolveWallet(input: unknown, text: string): string {
  return field(input, 'payoutAddress', 'wallet', 'refundAddress', 'to') || (text.match(WALLET)?.[0] ?? '');
}

export function buildSoldServices(
  rail: () => PaymentRail,
  prices: { insure: number; claim: number; certificate: number },
): Record<SoldServiceKind, SoldServiceHandler> {
  /** 1) INSURE A HIRE — underwrite the target, bind a policy, take the premium. */
  const insure: SoldServiceHandler = async (input) => {
    const text = asText(input);
    const serviceId = await resolveServiceId(input, text);
    const requirements = field(input, 'requirements', 'job', 'task', 'query', 'description') || text;
    const payoutAddress = resolveWallet(input, text);
    if (!serviceId)
      throw new Error(
        'Which store service do you want to insure? Send {"serviceId": "...", "requirements": "..."} or plain text that mentions the serviceId or the exact service name.',
      );
    if (!requirements) throw new Error('Missing "requirements" — what are you asking that agent to do?');

    const uw = await underwrite(rail(), serviceId, requirements);
    const premium = prices.insure;
    const coverage = coverageFor(premium, uw.riskScore);

    const policy = createPolicy({
      insuredServiceId: serviceId,
      insuredServiceName: uw.service?.name ?? serviceId,
      insuredAgentId: uw.service?.agentId ?? '',
      requirements,
      premium,
      coverage,
      riskScore: uw.riskScore,
      riskBand: bandFor(uw.riskScore),
      rationale: uw.rationale,
      ...(payoutAddress ? { payoutAddress } : {}),
    });

    recordPremium(premium);
    rail().credit('surety', premium);

    return policyDeliverable(policy, uw.trustHire);
  };

  /** 2) FILE A CLAIM — verify the delivery, refund if it failed. */
  const claim: SoldServiceHandler = async (input) => {
    const text = asText(input);
    const policyId = field(input, 'policyId', 'policy') || (text.match(POLICY_ID)?.[0] ?? '');
    const deliverable = field(input, 'deliverable', 'delivery', 'output', 'result') || text;
    const payoutAddress = resolveWallet(input, text);
    if (!policyId)
      throw new Error(
        'Missing policyId — mention it in your message (it looks like pol_1a2b3c4d and is on your Insure a Hire deliverable).',
      );

    recordPremium(prices.claim); // the claim-filing fee is revenue too
    rail().credit('surety', prices.claim);

    const c = await processClaim(rail(), {
      policyId,
      deliverable,
      ...(payoutAddress ? { payoutAddress } : {}),
    });
    return {
      claimId: c.claimId,
      policyId: c.policyId,
      verdict: c.verdict,
      confidence: c.confidence,
      approved: c.payout.status !== 'none',
      refund:
        c.payout.status === 'none'
          ? null
          : { amountUsdc: c.payout.amount, status: c.payout.status, via: c.payout.via ?? null },
      independentVerifier: c.externalVerifier
        ? { service: c.externalVerifier.serviceName, opinion: c.externalVerifier.opinion }
        : null,
      rationale: c.rationale,
    };
  };

  /** 3) AGENT RISK CERTIFICATE — underwriting intelligence as a standalone product. */
  const certificate: SoldServiceHandler = async (input) => {
    const text = asText(input);
    const serviceId = (await resolveServiceId(input, text)) || field(input, 'agentId');
    if (!serviceId)
      throw new Error(
        'Which store service should be assessed? Send {"serviceId": "..."} or plain text that mentions the serviceId or the exact service name.',
      );

    recordPremium(prices.certificate);
    rail().credit('surety', prices.certificate);

    const uw = await underwrite(rail(), serviceId, 'General reliability assessment for a prospective buyer.');
    const premium = prices.insure;
    const coverage = coverageFor(premium, uw.riskScore);

    let summary = '';
    try {
      summary = await llm(
        'You are an underwriting analyst. Write a crisp 3-sentence risk certificate summary for a buyer deciding whether to hire this AI-agent service.',
        `Service: ${uw.service?.name ?? serviceId}\nRisk score: ${uw.riskScore}/100 (${bandFor(uw.riskScore)})\nSignals: ${uw.rationale.slice(0, 700)}`,
        { temperature: 0.3, maxTokens: 250 },
      );
    } catch {
      summary = `Risk score ${uw.riskScore}/100 (${bandFor(uw.riskScore)}). ${uw.rationale.slice(0, 300)}`;
    }

    return {
      certificate: 'Surety Agent Risk Certificate v1',
      serviceId,
      serviceName: uw.service?.name ?? null,
      riskScore: uw.riskScore,
      riskBand: bandFor(uw.riskScore),
      summary,
      signals: uw.rationale,
      indicativeTerms: {
        premiumUsdc: premium,
        coverageUsdc: coverage,
      },
      trustDataPurchasedFrom: uw.trustHire?.serviceName ?? null,
      issuedAt: new Date().toISOString(),
    };
  };

  return { insure, claim, certificate };
}

function policyDeliverable(
  policy: Policy,
  trustHire?: { serviceName: string; priceUsdc: number; orderId: string },
) {
  return {
    policy: 'Surety Delivery Insurance v1',
    policyId: policy.policyId,
    insured: {
      serviceId: policy.insuredServiceId,
      serviceName: policy.insuredServiceName,
    },
    requirements: policy.requirements,
    premiumUsdc: policy.premium,
    coverageUsdc: policy.coverage,
    riskScore: policy.riskScore,
    riskBand: policy.riskBand,
    expiresAt: new Date(policy.expiresAt).toISOString(),
    howToClaim:
      'If the delivery fails, buy the "File a Claim" service with { policyId, deliverable, payoutAddress }. An independent verification agent will judge it; approved claims are refunded in USDC automatically.',
    underwritingNotes: policy.rationale,
    trustDataPurchasedFrom: trustHire?.serviceName ?? null,
    reserveFloatUsdc: round6(poolFloat()),
    pool: getPool(),
  };
}
