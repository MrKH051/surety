import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { emit } from '../bus.js';

/**
 * THE POLICY BOOK — Surety's source of truth.
 *
 * Every policy, claim, and USDC movement is recorded here and persisted to
 * disk (data/state.json), so a 24/7 deployment survives restarts without
 * losing a single active policy.
 */

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH';
export type PolicyStatus =
  | 'active'
  | 'expired'
  | 'claim_pending'
  | 'claim_denied'
  | 'claim_paid'
  | 'claim_owed'; // approved, but the on-chain refund hasn't settled yet
export type Verdict = 'satisfied' | 'unsatisfied' | 'inconclusive';

export interface Policy {
  policyId: string;
  createdAt: number;
  expiresAt: number;
  /** The store service the customer wants to hire (the insured job). */
  insuredServiceId: string;
  insuredServiceName: string;
  insuredAgentId: string;
  /** What the customer asked that agent to do (the acceptance contract). */
  requirements: string;
  /** Premium actually collected (USDC) = the price of our "Insure a Hire" service. */
  premium: number;
  /** Max refund if the delivery fails verification (USDC). */
  coverage: number;
  riskScore: number; // 0 (safe) … 100 (risky)
  riskBand: RiskBand;
  rationale: string;
  status: PolicyStatus;
  /** Where a claim refund should be sent (Base wallet or .base.eth name). */
  payoutAddress?: string;
}

export interface Claim {
  claimId: string;
  policyId: string;
  filedAt: number;
  deliverable: string;
  verdict: Verdict;
  confidence: number;
  rationale: string;
  externalVerifier?: { serviceName: string; priceUsdc: number; orderId: string; opinion: string };
  /** Automatic on-chain verification of the claimant's order proof (if any). */
  proof?: { provided: boolean; valid: boolean; txHash?: string; reason: string };
  payout: { amount: number; status: 'paid' | 'owed' | 'none'; via?: string; orderId?: string; txHash?: string };
}

/** The reserve pool ledger (USDC, human units). */
export interface Pool {
  capital: number; // seed capital the insurer itself put at stake
  premiums: number; // total premiums collected
  payouts: number; // total claim refunds paid
  costs: number; // total spent hiring verifier/trust/payout specialists
}

interface State {
  policies: Policy[];
  claims: Claim[];
  pool: Pool;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const state: State = loadState();

function loadState(): State {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as State;
    if (Array.isArray(parsed.policies) && Array.isArray(parsed.claims) && parsed.pool) {
      parsed.pool.capital ??= config.insurance.seedCapital;
      return parsed;
    }
  } catch {
    /* first run — start with an empty book */
  }
  return {
    policies: [],
    claims: [],
    pool: { capital: config.insurance.seedCapital, premiums: 0, payouts: 0, costs: 0 },
  };
}

function saveState(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

/** Net float available to pay claims. */
export function poolFloat(): number {
  return round6(state.pool.capital + state.pool.premiums - state.pool.payouts - state.pool.costs);
}

export function getPool(): Pool {
  return { ...state.pool };
}

export function recordPremium(amount: number): void {
  state.pool.premiums = round6(state.pool.premiums + amount);
  saveState();
  emit({ type: 'pool', pool: getPool(), float: poolFloat() });
}

export function recordCost(amount: number): void {
  state.pool.costs = round6(state.pool.costs + amount);
  saveState();
  emit({ type: 'pool', pool: getPool(), float: poolFloat() });
}

export function recordPayout(amount: number): void {
  state.pool.payouts = round6(state.pool.payouts + amount);
  saveState();
  emit({ type: 'pool', pool: getPool(), float: poolFloat() });
}

/**
 * VALUE-BASED COVERAGE. Coverage is anchored to the VALUE AT RISK — the price
 * the buyer actually paid the insured agent — not a blind multiple of our
 * premium. It is then bounded by four sane limits so the pool stays solvent
 * and a tiny premium can't buy huge cover:
 *   1. risk share    — cover 100% of a safe hire's value, less as risk rises
 *   2. premium cap    — never more than `coverageMultiple` × the premium
 *   3. hard cap       — MAX_COVERAGE
 *   4. solvency guard — at most half of the reserve float
 *
 * `insuredValue` is the insured service's real store price (0 if unknown).
 */
export function coverageFor(premium: number, riskScore: number, insuredValue = 0): number {
  const share =
    riskScore < 30
      ? config.insurance.coverageShare.low
      : riskScore < 60
        ? config.insurance.coverageShare.medium
        : config.insurance.coverageShare.high;

  // Value at risk. If we couldn't read the insured service's price, fall back
  // to the premium-multiple cap alone (conservative).
  const atRisk = insuredValue > 0 ? insuredValue * share : premium * config.insurance.coverageMultiple;

  const float = poolFloat();
  const coverage = Math.min(
    atRisk,
    premium * config.insurance.coverageMultiple,
    config.insurance.maxCoverage,
    Math.max(float * 0.5, premium * 2), // solvency guard, with a bootstrap floor
  );
  return round6(coverage);
}

/**
 * Value-based coverage for a QUOTE — bounded only by the hard cap and pool
 * solvency (NOT by any specific premium), so a certificate can show what a
 * properly-priced tier would cover for this service's full value.
 */
export function quoteCoverage(insuredValue: number, riskScore: number): number {
  const share =
    riskScore < 30
      ? config.insurance.coverageShare.low
      : riskScore < 60
        ? config.insurance.coverageShare.medium
        : config.insurance.coverageShare.high;
  const float = poolFloat();
  return round6(Math.min(insuredValue * share, config.insurance.maxCoverage, Math.max(float * 0.5, 0.5)));
}

/**
 * A fair premium for a given coverage amount. The rate rises with risk (a
 * riskier hire is likelier to pay out) and is floored so it can't fall below
 * our per-claim cost.
 */
export function suggestedPremium(coverage: number, riskScore: number): number {
  const rate =
    riskScore < 30
      ? config.insurance.premiumRate
      : riskScore < 60
        ? config.insurance.premiumRate * 1.5
        : config.insurance.premiumRate * 2.5;
  return round6(Math.max(config.insurance.premiumFloor, coverage * rate));
}

export function bandFor(riskScore: number): RiskBand {
  return riskScore < 30 ? 'LOW' : riskScore < 60 ? 'MEDIUM' : 'HIGH';
}

export function createPolicy(
  p: Omit<Policy, 'policyId' | 'createdAt' | 'expiresAt' | 'status'>,
): Policy {
  const policy: Policy = {
    ...p,
    policyId: 'pol_' + randomUUID().slice(0, 8),
    createdAt: Date.now(),
    expiresAt: Date.now() + config.insurance.policyHours * 3600_000,
    status: 'active',
  };
  state.policies.unshift(policy);
  saveState();
  emit({ type: 'policy', policy });
  return policy;
}

export function getPolicy(policyId: string): Policy | undefined {
  const policy = state.policies.find((x) => x.policyId === policyId);
  if (policy && policy.status === 'active' && policy.expiresAt < Date.now()) {
    policy.status = 'expired';
    saveState();
    emit({ type: 'policy', policy });
  }
  return policy;
}

export function updatePolicy(policy: Policy): void {
  saveState();
  emit({ type: 'policy', policy });
}

export function createClaim(c: Omit<Claim, 'claimId' | 'filedAt'>): Claim {
  const claim: Claim = { ...c, claimId: 'clm_' + randomUUID().slice(0, 8), filedAt: Date.now() };
  state.claims.unshift(claim);
  saveState();
  emit({ type: 'claim', claim });
  return claim;
}

export function updateClaim(claim: Claim): void {
  saveState();
  emit({ type: 'claim', claim });
}

export function listPolicies(limit = 50): Policy[] {
  // Sweep expiries lazily so the dashboard always shows true statuses.
  const now = Date.now();
  for (const p of state.policies) {
    if (p.status === 'active' && p.expiresAt < now) p.status = 'expired';
  }
  return state.policies.slice(0, limit);
}

export function listClaims(limit = 50): Claim[] {
  return state.claims.slice(0, limit);
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
