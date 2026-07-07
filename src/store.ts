import { config } from './config.js';
import { emit } from './bus.js';

/**
 * CROO AGENT STORE DISCOVERY — the open-network half of Surety.
 *
 * Surety never works alone: it BUYS three kinds of specialist work from
 * other teams' agents, discovered live from the public store API:
 *
 *   verifier — independent output verification (is this delivery any good?)
 *   trust    — reputation / due-diligence data used to price premiums
 *   payout   — an on-chain USDC payment agent that sends claim refunds
 */

export interface StoreService {
  serviceId: string;
  agentId: string;
  name: string;
  description: string;
  price: number; // USDC, human units
  orders7d: number;
  /** Whether this service needs the principal declared as an on-chain fund transfer. */
  fundRequired: boolean;
}

/** Read `fund_transfer_required` from a service's feeConfig (may be a JSON string). */
function parseFundRequired(feeConfig: unknown): boolean {
  try {
    const cfg = typeof feeConfig === 'string' ? JSON.parse(feeConfig) : feeConfig;
    return Boolean((cfg as any)?.fund_transfer_required);
  } catch {
    return false;
  }
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { services: StoreService[]; fetchedAt: number } | null = null;

/** Snapshot every service on the store (public endpoint caps at 50/page). */
export async function getStoreServices(): Promise<StoreService[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.services;

  const services: StoreService[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(
      `${config.croo.apiUrl}/backend/v1/public/services?page=${page}&page_size=50`,
      { headers: { 'User-Agent': 'surety/0.1' } },
    );
    if (!res.ok) break;
    const data = (await res.json()) as { items?: any[]; total?: string | number };
    const items = data.items ?? [];
    if (items.length === 0) break;
    for (const it of items) {
      services.push({
        serviceId: it.serviceId,
        agentId: it.agentId,
        name: String(it.name ?? ''),
        description: String(it.description ?? ''),
        price: Number(it.price ?? 0) / 1_000_000,
        orders7d: Number(it.orders7d ?? 0),
        fundRequired: parseFundRequired(it.feeConfig),
      });
    }
    const total = Number(data.total ?? 0);
    if (total > 0 && services.length >= total) break;
  }
  cache = { services, fetchedAt: Date.now() };
  return services;
}

/** Find one service by its exact serviceId (used to underwrite a target). */
export async function findService(serviceId: string): Promise<StoreService | undefined> {
  const services = await getStoreServices();
  return services.find((s) => s.serviceId === serviceId);
}

// ---- Agent reputation (so we only hire agents that actually deliver) -------

export interface AgentRep {
  completionRate: number; // 0-100
  completedOrders: number;
  online: boolean;
}

let agentCache: { map: Map<string, AgentRep>; fetchedAt: number } | null = null;

/** Fetch each agent's completion rate / order count (cached). */
export async function getAgentReputation(): Promise<Map<string, AgentRep>> {
  if (agentCache && Date.now() - agentCache.fetchedAt < CACHE_TTL_MS) return agentCache.map;
  const map = new Map<string, AgentRep>();
  try {
    for (let page = 1; page <= 40; page++) {
      const res = await fetch(
        `${config.croo.apiUrl}/backend/v1/public/agents?page=${page}&page_size=50`,
        { headers: { 'User-Agent': 'surety/0.1' } },
      );
      if (!res.ok) break;
      const data = (await res.json()) as { agents?: any[] };
      const items = data.agents ?? [];
      if (items.length === 0) break;
      for (const a of items) {
        map.set(a.agentId, {
          completionRate: Number(a.completionRate ?? 0),
          completedOrders: Number(a.completedOrders ?? 0),
          online: String(a.onlineStatus ?? '').toLowerCase() === 'online',
        });
      }
      if (items.length < 50) break;
    }
  } catch {
    /* reputation unavailable — callers fall back to not filtering */
  }
  agentCache = { map, fetchedAt: Date.now() };
  return map;
}

export type SpecialistKind = 'verifier' | 'trust' | 'payout';

const KEYWORDS: Record<SpecialistKind, string[]> = {
  // Ordered strongest→weakest. A verifier must judge whether a *delivery*
  // meets its requirements — NOT check a crypto token. Delivery/output/claim
  // reviewers rank first; generic "verify/fact-check" only as a last resort.
  verifier: [
    'delivery verdict', 'output audit', 'output verification', 'claim review',
    'claim verification', 'against contract', 'evaluate delivery', 'deliverable',
    'consistency check', 'hallucination', 'grade', 'evaluate', 'fact-check', 'fact check', 'verif',
  ],
  trust: ['trust score', 'due diligence', 'reputation', 'risk', 'score'],
  payout: ['usdc pay', 'send usdc', 'instant usdc', 'payment', 'pay'],
};

// A service is NEVER eligible for a role if its name/description matches one of
// these — they're the wrong TOOL even when a keyword accidentally matches
// (e.g. "Verify Crypto Shill" is a token checker, not a delivery verifier).
const BLOCK: Record<SpecialistKind, string[]> = {
  verifier: [
    'shill', 'token', 'memecoin', 'meme coin', 'rug', 'honeypot', 'smart contract',
    'contract audit', 'repo', 'github', 'depeg', 'stablecoin', 'wallet', 'address risk',
    'nft', 'price feed', 'gas ', 'sql', 'solana', 'on-chain', 'onchain', 'crypto',
    'defi', 'liquidity', 'holder', 'whale', 'sanctions', 'kyb', 'kyc', 'nutrition',
    'freight', 'vehicle', 'drug', 'patch', 'code',
  ],
  trust: ['shill', 'memecoin', 'honeypot', 'nutrition', 'freight', 'vehicle', 'drug'],
  payout: ['risk scan', 'risk check', 'audit', 'analytics', 'logging', 'signal', 'identity'],
};

/**
 * Shortlist external specialists of one kind: cheap, from OTHER teams, ranked
 * by keyword priority (name match first) then real traction. A pinned
 * serviceId from .env always goes first.
 */
export async function specialistCandidates(kind: SpecialistKind): Promise<StoreService[]> {
  const { excludeAgentIds } = config.external;
  const maxPrice = {
    verifier: config.external.verifierMaxPrice,
    trust: config.external.trustMaxPrice,
    payout: config.external.payoutMaxPrice,
  }[kind];
  const pinnedId = {
    verifier: config.external.pinnedVerifierServiceId,
    trust: config.external.pinnedTrustServiceId,
    payout: config.external.pinnedPayoutServiceId,
  }[kind];
  const keywords = KEYWORDS[kind];
  const blocked = BLOCK[kind];

  const [services, reputation] = await Promise.all([getStoreServices(), getAgentReputation()]);
  const isBlocked = (s: StoreService): boolean => {
    const blob = `${s.name} ${s.description}`.toLowerCase();
    return blocked.some((b) => blob.includes(b));
  };
  const rank = (s: StoreService): number => {
    const name = s.name.toLowerCase();
    const desc = s.description.toLowerCase();
    for (let i = 0; i < keywords.length; i++) if (name.includes(keywords[i])) return i;
    for (let i = 0; i < keywords.length; i++) if (desc.includes(keywords[i])) return keywords.length + i;
    return -1;
  };

  // Only hire agents that actually deliver: proven track record (≥95%
  // completion, ≥3 completed orders). If reputation data is missing for an
  // agent we skip it — better no hire than a hire that strands the order.
  const trustworthy = (agentId: string): boolean => {
    const rep = reputation.get(agentId);
    if (!rep) return reputation.size === 0; // no data at all ⇒ don't over-filter
    return rep.completionRate >= config.external.minCompletionRate && rep.completedOrders >= 3;
  };

  const list = services
    .map((s) => ({ s, rank: rank(s) }))
    .filter(
      ({ s, rank }) =>
        rank >= 0 &&
        s.price > 0 &&
        s.price <= maxPrice &&
        !excludeAgentIds.includes(s.agentId) &&
        !isBlocked(s) &&
        trustworthy(s.agentId),
    )
    // Online + active agents first, then keyword relevance, then traction.
    .sort(
      (a, b) =>
        Number(reputation.get(b.s.agentId)?.online ?? false) -
          Number(reputation.get(a.s.agentId)?.online ?? false) ||
        Number(b.s.orders7d > 0) - Number(a.s.orders7d > 0) ||
        a.rank - b.rank ||
        b.s.orders7d - a.s.orders7d ||
        a.s.price - b.s.price,
    )
    .map(({ s }) => s)
    .slice(0, 3);

  if (pinnedId) {
    const pinned = services.find((s) => s.serviceId === pinnedId);
    if (pinned) list.unshift(pinned);
  }

  if (list.length === 0) {
    emit({ type: 'log', level: 'warn', message: `No external ${kind} agent available on the store.` });
  }
  return list;
}
