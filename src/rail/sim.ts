import { randomUUID } from 'node:crypto';
import { emit, type AgentName } from '../bus.js';
import type {
  HireRequest,
  HireResult,
  PaymentRail,
  SoldServiceHandler,
  SoldServiceKind,
} from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A faithful, offline simulation of the CROO escrow lifecycle.
 *
 * It mirrors the real phases — negotiate -> accept -> lock -> deliver -> clear —
 * and actually moves balances between agents, so the dashboard tells the same
 * "agents paying each other" story whether or not we're connected to Base.
 *
 * The three external specialists (verifier / trust / payout) answer with
 * realistic canned outputs so every flow works end-to-end with zero setup.
 */
export class SimulatedRail implements PaymentRail {
  readonly name = 'Simulated escrow (offline)';

  private balances = new Map<AgentName, number>();
  private soldServices?: Record<SoldServiceKind, SoldServiceHandler>;

  async init(): Promise<void> {
    // Surety starts with a small operating float; specialists start empty.
    this.balances.set('surety', 5);
    this.balances.set('client', 10);
    this.balances.set('verifier', 0);
    this.balances.set('trust', 0);
    this.balances.set('payout', 0);
    for (const [agent, balance] of this.balances) {
      emit({ type: 'balance', agent, balance });
    }
  }

  setSoldServices(handlers: Record<SoldServiceKind, SoldServiceHandler>): void {
    this.soldServices = handlers;
  }

  balanceOf(agent: AgentName): number {
    return this.balances.get(agent) ?? 0;
  }

  credit(agent: AgentName, amount: number): void {
    this.balances.set(agent, round6(this.balanceOf(agent) + amount));
    emit({ type: 'balance', agent, balance: this.balanceOf(agent) });
  }

  deduct(agent: AgentName, amount: number): void {
    this.balances.set(agent, round6(this.balanceOf(agent) - amount));
    emit({ type: 'balance', agent, balance: this.balanceOf(agent) });
  }

  async hire(req: HireRequest): Promise<HireResult> {
    const { from, to, capability, input, price } = req;
    const orderId = 'sim_' + randomUUID().slice(0, 8);

    const phase = (p: string, extra: Record<string, unknown> = {}) =>
      emit({
        type: 'order', orderId, from, to,
        ...(req.toName ? { toName: req.toName } : {}),
        capability, amount: price, phase: p, ...extra,
      });

    // 1) Negotiate — Surety proposes terms to the specialist.
    phase('negotiate');
    await sleep(400);

    // 2) Accept — the specialist agrees.
    phase('accept');
    await sleep(300);

    // 3) Lock — funds leave the payer and sit in escrow.
    this.deduct(from, price);
    phase('lock');
    await sleep(400);

    // 4) Work — the simulated specialist produces its deliverable.
    emit({ type: 'agent', agent: to, state: 'working' });
    await sleep(800);
    const result = simulatedSpecialist(to, input);
    emit({ type: 'agent', agent: to, state: 'idle' });

    // 5) Deliver — the specialist submits the result.
    phase('deliver');
    await sleep(300);

    // 6) Clear — escrow releases the funds to the specialist.
    this.credit(to, price);
    phase('clear');
    await sleep(200);

    return { orderId, result, price };
  }

  async shutdown(): Promise<void> {
    /* nothing to clean up for the simulated rail */
  }
}

/** Canned-but-plausible outputs for each specialist role. */
function simulatedSpecialist(to: AgentName, input: unknown): unknown {
  const obj = (input ?? {}) as Record<string, unknown>;

  if (to === 'trust') {
    return {
      simulated: true,
      report:
        'Trust assessment (simulated third-party agent): the target shows a consistent delivery history, ' +
        'no dispute flags, and a plausible service description. Composite trust score: 68/100. ' +
        'Caveat: limited long-term track record on the marketplace.',
    };
  }

  if (to === 'verifier') {
    // Judge with the same public information a real verifier would get.
    const requirements = String(obj.requirements ?? '');
    const deliverable = String(obj.deliverable ?? '');
    const overlap = keywordOverlap(requirements, deliverable);
    const pass = deliverable.trim().length >= 30 && overlap >= 0.25;
    return {
      simulated: true,
      verdict: pass ? 'PASS' : 'FAIL',
      reason: pass
        ? `The deliverable addresses the requirements (topic overlap ${(overlap * 100).toFixed(0)}%).`
        : deliverable.trim().length < 30
          ? 'The deliverable is effectively empty.'
          : `The deliverable does not address the stated requirements (topic overlap ${(overlap * 100).toFixed(0)}%).`,
    };
  }

  if (to === 'payout') {
    return {
      simulated: true,
      status: 'sent',
      txHash: '0xsim' + randomUUID().replace(/-/g, '').slice(0, 60),
      to: String(obj.to ?? obj.recipient ?? obj.address ?? ''),
      amountUsdc: Number(obj.amount ?? obj.amountUsdc ?? 0),
    };
  }

  return { simulated: true, echo: obj };
}

function keywordOverlap(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size) return 0;
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit++;
  return hit / ta.size;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
