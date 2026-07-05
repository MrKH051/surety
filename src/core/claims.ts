import { config } from '../config.js';
import { emit } from '../bus.js';
import { llm } from '../llm.js';
import { specialistCandidates, type StoreService } from '../store.js';
import {
  createClaim,
  getPolicy,
  recordCost,
  recordPayout,
  round6,
  updateClaim,
  updatePolicy,
  type Claim,
  type Verdict,
} from './policy.js';
import type { PaymentRail } from '../rail/types.js';

/**
 * CLAIMS — the moment an insurance product earns its keep.
 *
 * 1. The claimant sends the deliverable they received for the insured job.
 * 2. Surety HIRES an independent verification agent from another team to
 *    give a second opinion on whether the delivery meets the requirements.
 * 3. Surety's adjudicator combines that opinion with its own analysis into
 *    a verdict. "unsatisfied" (with enough confidence) means the claim is
 *    approved.
 * 4. Approved refunds are sent by HIRING an on-chain payment agent — even
 *    the payout is an A2A transaction.
 */

export interface ClaimRequest {
  policyId: string;
  deliverable: string;
  /** Override the payout destination recorded on the policy. */
  payoutAddress?: string;
}

/** Deterministic fallback verdict: keyword overlap between ask and delivery. */
function heuristicVerdict(requirements: string, deliverable: string): { verdict: Verdict; confidence: number; note: string } {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    );
  const req = tokens(requirements);
  const del = tokens(deliverable);
  if (deliverable.trim().length < 30) {
    return { verdict: 'unsatisfied', confidence: 0.8, note: 'deliverable is effectively empty' };
  }
  let hit = 0;
  for (const w of req) if (del.has(w)) hit++;
  const overlap = req.size ? hit / req.size : 0;
  if (overlap >= 0.35) {
    return { verdict: 'satisfied', confidence: 0.6, note: `keyword overlap ${(overlap * 100).toFixed(0)}%` };
  }
  if (overlap >= 0.15) {
    return { verdict: 'inconclusive', confidence: 0.4, note: `keyword overlap ${(overlap * 100).toFixed(0)}%` };
  }
  return { verdict: 'unsatisfied', confidence: 0.6, note: `keyword overlap ${(overlap * 100).toFixed(0)}%` };
}

/** Best-effort second opinion from a third-party verification agent. */
async function hireVerifier(
  rail: PaymentRail,
  requirements: string,
  deliverable: string,
  excludeAgentId?: string,
): Promise<{ opinion: string; serviceName: string; price: number; orderId: string } | null> {
  if (!config.external.enabled) return null;
  let candidates: StoreService[];
  try {
    candidates = await specialistCandidates('verifier');
  } catch {
    return null;
  }

  for (const c of candidates.slice(0, 2)) {
    // The agent whose work is disputed must never judge its own delivery.
    if (excludeAgentId && c.agentId === excludeAgentId) continue;
    try {
      const r = await rail.hire({
        from: 'surety',
        to: 'verifier',
        toName: c.name,
        serviceId: c.serviceId,
        capability: 'verify.delivery',
        input: {
          task: 'Judge whether the deliverable satisfies the stated requirements. Answer with PASS or FAIL plus a short reason.',
          requirements,
          deliverable: deliverable.slice(0, 4000),
          claim: `Requirements: ${requirements.slice(0, 800)}\n\nDeliverable to judge:\n${deliverable.slice(0, 2500)}`,
        },
        price: c.price,
      });
      recordCost(r.price);
      const raw = r.result as any;
      const opinion =
        typeof raw === 'string' ? raw : JSON.stringify(raw ?? '', null, 0).slice(0, 1500);
      if (!opinion.trim()) continue;
      return { opinion: opinion.slice(0, 1500), serviceName: c.name, price: r.price, orderId: r.orderId };
    } catch (err) {
      emit({
        type: 'log',
        level: 'warn',
        message: `Verifier hire "${c.name}" failed (${String((err as Error).message ?? err)}) — trying next.`,
      });
    }
  }
  return null;
}

/** Send the refund by hiring an on-chain USDC payment agent. */
async function sendPayout(
  rail: PaymentRail,
  amount: number,
  to: string,
): Promise<{ status: 'paid' | 'owed'; via?: string; orderId?: string }> {
  let candidates: StoreService[] = [];
  if (config.external.enabled) {
    try {
      candidates = await specialistCandidates('payout');
    } catch {
      /* fall through to "owed" */
    }
  }

  for (const c of candidates.slice(0, 2)) {
    // Don't overpay fees on tiny refunds: skip payment agents that cost
    // more than the refund itself.
    if (c.price > amount) continue;
    try {
      const r = await rail.hire({
        from: 'surety',
        to: 'payout',
        toName: c.name,
        serviceId: c.serviceId,
        capability: 'payout.usdc',
        input: {
          to,
          recipient: to,
          address: to,
          amount,
          amountUsdc: amount,
          memo: 'Surety insurance claim refund',
        },
        price: c.price,
        // The refund principal rides along as an on-chain fund transfer.
        fundUsdc: amount,
      });
      recordCost(r.price);
      return { status: 'paid', via: c.name, orderId: r.orderId };
    } catch (err) {
      emit({
        type: 'log',
        level: 'warn',
        message: `Payout via "${c.name}" failed (${String((err as Error).message ?? err)}) — trying next.`,
      });
    }
  }

  // No payment agent available: record the debt so it is never lost.
  return { status: 'owed' };
}

export async function processClaim(rail: PaymentRail, req: ClaimRequest): Promise<Claim> {
  const policy = getPolicy(req.policyId);
  if (!policy) throw new Error(`Unknown policy "${req.policyId}".`);
  if (policy.status === 'expired') throw new Error(`Policy ${policy.policyId} has expired.`);
  if (policy.status !== 'active') throw new Error(`Policy ${policy.policyId} was already claimed (${policy.status}).`);
  const deliverable = String(req.deliverable ?? '').trim();
  if (!deliverable) throw new Error('A claim needs the deliverable you received.');

  policy.status = 'claim_pending';
  updatePolicy(policy);
  emit({ type: 'agent', agent: 'surety', state: 'working' });

  try {
    // 1) Independent second opinion from another team's verification agent.
    const external = await hireVerifier(rail, policy.requirements, deliverable, policy.insuredAgentId);

    // 2) Adjudicate: heuristic baseline, refined by the AI brain.
    const base = heuristicVerdict(policy.requirements, deliverable);
    let verdict: Verdict = base.verdict;
    let confidence = base.confidence;
    let rationale = `heuristic: ${base.note}`;

    try {
      const answer = await llm(
        'You are a neutral insurance claim adjudicator for AI-agent work. Decide whether the deliverable satisfies the job requirements. Reply with a single line "VERDICT: SATISFIED", "VERDICT: UNSATISFIED" or "VERDICT: INCONCLUSIVE", then "CONFIDENCE: <0-1>", then a short justification.',
        [
          `Job requirements:\n${policy.requirements.slice(0, 1200)}`,
          `Deliverable received:\n${deliverable.slice(0, 3000)}`,
          external
            ? `Independent verifier's opinion (from "${external.serviceName}"):\n${external.opinion.slice(0, 1000)}`
            : 'No independent verifier was available.',
          `Baseline heuristic said: ${base.verdict} (${base.note}).`,
        ].join('\n\n'),
        { temperature: 0.1, maxTokens: 500 },
      );
      const vm = answer.match(/verdict:\s*(satisfied|unsatisfied|inconclusive)/i);
      const cm = answer.match(/confidence:\s*([01](?:\.\d+)?)/i);
      if (vm) verdict = vm[1].toLowerCase() as Verdict;
      if (cm) confidence = Number(cm[1]);
      rationale = answer
        .replace(/verdict:\s*\w+/i, '')
        .replace(/confidence:\s*[\d.]+/i, '')
        .trim()
        .slice(0, 700);
    } catch {
      /* heuristic verdict stands */
    }

    // 3) Payout on approved claims.
    const approved = verdict === 'unsatisfied' && confidence >= config.insurance.minPayoutConfidence;
    let payout: Claim['payout'] = { amount: 0, status: 'none' };

    if (approved) {
      const amount = round6(policy.coverage);
      const destination = req.payoutAddress ?? policy.payoutAddress;
      if (destination) {
        const sent = await sendPayout(rail, amount, destination);
        payout = { amount, ...sent };
      } else {
        payout = { amount, status: 'owed' };
      }
      recordPayout(amount);
      rail.deduct('surety', amount);
      policy.status = 'claim_paid';
    } else {
      policy.status = 'claim_denied';
    }
    updatePolicy(policy);

    const claim = createClaim({
      policyId: policy.policyId,
      deliverable: deliverable.slice(0, 2000),
      verdict,
      confidence,
      rationale,
      ...(external
        ? {
            externalVerifier: {
              serviceName: external.serviceName,
              priceUsdc: external.price,
              orderId: external.orderId,
              opinion: external.opinion.slice(0, 600),
            },
          }
        : {}),
      payout,
    });

    emit({
      type: 'log',
      level: 'info',
      message: approved
        ? `Claim ${claim.claimId} APPROVED — ${payout.amount} USDC refund (${payout.status}${payout.via ? ` via ${payout.via}` : ''}).`
        : `Claim ${claim.claimId} ${verdict === 'satisfied' ? 'DENIED — delivery satisfied the requirements' : 'DENIED — inconclusive evidence'}.`,
    });
    return claim;
  } catch (err) {
    // Adjudication itself failed — reopen the policy so the claim can be retried.
    policy.status = 'active';
    updatePolicy(policy);
    throw err;
  } finally {
    emit({ type: 'agent', agent: 'surety', state: 'idle' });
  }
}
