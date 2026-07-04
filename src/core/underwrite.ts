import { config } from '../config.js';
import { emit } from '../bus.js';
import { llm } from '../llm.js';
import { findService, specialistCandidates, type StoreService } from '../store.js';
import { recordCost, round6 } from './policy.js';
import type { PaymentRail } from '../rail/types.js';

/**
 * UNDERWRITING — pricing the risk of one agent's promise.
 *
 * Signals, in order of weight:
 *   1. Live marketplace data for the target service (price, 7-day traction).
 *   2. A trust/reputation report BOUGHT from another team's agent on the
 *      store (best effort — underwriting still works if nobody sells one).
 *   3. An LLM read of the service description (scam smell, vagueness).
 */

export interface Underwriting {
  riskScore: number; // 0 safe … 100 risky
  rationale: string;
  service: StoreService | null;
  trustHire?: { serviceName: string; priceUsdc: number; orderId: string };
}

/** Deterministic base score from live store signals (works with zero AI). */
function heuristicScore(service: StoreService | null): { score: number; notes: string[] } {
  if (!service) {
    return { score: 75, notes: ['target service not found on the public store (+risk)'] };
  }
  let score = 50;
  const notes: string[] = [];

  if (service.orders7d >= 20) {
    score -= 20;
    notes.push(`strong traction: ${service.orders7d} orders in 7 days (−risk)`);
  } else if (service.orders7d >= 5) {
    score -= 10;
    notes.push(`some traction: ${service.orders7d} orders in 7 days (−risk)`);
  } else {
    score += 10;
    notes.push(`little traction: ${service.orders7d} orders in 7 days (+risk)`);
  }

  if (service.description.trim().length >= 120) {
    score -= 10;
    notes.push('detailed service description (−risk)');
  } else if (service.description.trim().length < 40) {
    score += 10;
    notes.push('thin service description (+risk)');
  }

  if (service.price >= 1) {
    score += 10;
    notes.push('high-ticket service: bigger loss surface (+risk)');
  }

  return { score: Math.max(5, Math.min(95, score)), notes };
}

/** Best-effort trust report bought from a third-party agent. Never throws. */
async function buyTrustSignal(
  rail: PaymentRail,
  target: { serviceId: string; agentId: string; name: string },
): Promise<{ text: string; serviceName: string; price: number; orderId: string } | null> {
  if (!config.external.enabled) return null;
  let candidates: StoreService[];
  try {
    candidates = await specialistCandidates('trust');
  } catch {
    return null;
  }

  for (const c of candidates) {
    // Never ask an agent to rate itself.
    if (c.agentId === target.agentId) continue;
    try {
      const r = await rail.hire({
        from: 'surety',
        to: 'trust',
        toName: c.name,
        serviceId: c.serviceId,
        capability: 'trust.report',
        input: {
          agentId: target.agentId,
          serviceId: target.serviceId,
          query: `Trust and reliability assessment for CROO agent service "${target.name}" (service ${target.serviceId}, agent ${target.agentId}).`,
        },
        price: c.price,
      });
      recordCost(r.price);
      const raw = r.result as any;
      const text =
        typeof raw === 'string' ? raw : JSON.stringify(raw ?? '', null, 0).slice(0, 1500);
      if (!text.trim()) continue;
      return { text: text.slice(0, 1500), serviceName: c.name, price: r.price, orderId: r.orderId };
    } catch (err) {
      emit({
        type: 'log',
        level: 'warn',
        message: `Trust hire "${c.name}" failed (${String((err as Error).message ?? err)}) — trying next.`,
      });
    }
  }
  return null;
}

export async function underwrite(
  rail: PaymentRail,
  insuredServiceId: string,
  requirements: string,
): Promise<Underwriting> {
  emit({ type: 'agent', agent: 'surety', state: 'working' });
  try {
    let service: StoreService | null = null;
    try {
      service = (await findService(insuredServiceId)) ?? null;
    } catch {
      /* store unreachable — underwrite blind, at higher risk */
    }

    const { score: baseScore, notes } = heuristicScore(service);

    const trust = service
      ? await buyTrustSignal(rail, {
          serviceId: service.serviceId,
          agentId: service.agentId,
          name: service.name,
        })
      : null;

    // Ask the AI brain to nudge the heuristic score using the qualitative data.
    let riskScore = baseScore;
    let aiNote = '';
    try {
      const answer = await llm(
        'You are an insurance underwriting analyst for AI-agent services. Given marketplace data and an optional third-party trust report, adjust a base risk score. Reply with a single line "SCORE: <0-100>" then a one-paragraph justification.',
        [
          `Base heuristic risk score: ${baseScore} (0 = safe, 100 = risky).`,
          `Heuristic notes: ${notes.join('; ')}`,
          service
            ? `Target service: "${service.name}" — $${service.price} USDC, ${service.orders7d} orders in 7 days.\nDescription: ${service.description.slice(0, 500)}`
            : 'Target service: not found on the public store.',
          `Customer's job requirements: ${requirements.slice(0, 400)}`,
          trust ? `Third-party trust report (from "${trust.serviceName}"): ${trust.text.slice(0, 800)}` : 'No third-party trust report available.',
        ].join('\n\n'),
        { temperature: 0.2, maxTokens: 400 },
      );
      const m = answer.match(/score:\s*(\d{1,3})/i);
      if (m) {
        const aiScore = Math.max(0, Math.min(100, Number(m[1])));
        // The model refines, it does not override: cap the drift at ±15.
        riskScore = Math.max(baseScore - 15, Math.min(baseScore + 15, aiScore));
      }
      aiNote = answer.replace(/score:\s*\d{1,3}/i, '').trim().slice(0, 500);
    } catch {
      /* heuristic-only underwriting is fine */
    }

    const rationale = [
      ...notes,
      trust ? `third-party trust report purchased from "${trust.serviceName}"` : 'no third-party trust data available',
      aiNote,
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      riskScore: round6(riskScore),
      rationale,
      service,
      ...(trust
        ? { trustHire: { serviceName: trust.serviceName, priceUsdc: trust.price, orderId: trust.orderId } }
        : {}),
    };
  } finally {
    emit({ type: 'agent', agent: 'surety', state: 'idle' });
  }
}
