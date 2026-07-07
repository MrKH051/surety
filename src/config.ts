import process from 'node:process';

// Load variables from a local ".env" file if one exists.
// (Node 20.12+ ships this built in — no extra library needed.)
try {
  process.loadEnvFile?.();
} catch {
  // No .env file present — that's fine, we fall back to safe defaults below.
}

export type RailName = 'sim' | 'croo';

export const config = {
  port: Number(process.env.PORT ?? 3100),

  // Which payment rail to use:
  //   "sim"  -> simulated escrow, runs fully offline (great for demos / first run)
  //   "croo" -> real CROO Agent Protocol on Base
  rail: (process.env.RAIL ?? 'sim') as RailName,

  // The AI brain used for underwriting and claim adjudication.
  // Any OpenAI-compatible endpoint works; a local Ollama is the easiest
  // free, no-key option (`ollama pull llama3.1` then it just works).
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
    model: process.env.LLM_MODEL ?? 'llama3.1',
    apiKey: process.env.LLM_API_KEY ?? '',
  },

  // Real CROO settings (only used when rail === "croo").
  croo: {
    apiUrl: process.env.CROO_API_URL ?? 'https://api.croo.network',
    wsUrl: process.env.CROO_WS_URL ?? 'wss://api.croo.network/ws',
    rpcUrl: process.env.CROO_RPC_URL || undefined,

    // Surety is a single agent profile: it SELLS three services and BUYS
    // verification / trust-data / payout services from other teams.
    sdkKey: process.env.CROO_SURETY_SDK_KEY ?? '',

    // Our three listed services on the CROO Agent Store.
    serviceIds: {
      insure: process.env.CROO_INSURE_SERVICE_ID ?? '',
      claim: process.env.CROO_CLAIM_SERVICE_ID ?? '',
      certificate: process.env.CROO_CERTIFICATE_SERVICE_ID ?? '',
    },

    // Display-only float shown on the dashboard in croo mode.
    startBalance: Number(process.env.CROO_START_BALANCE ?? 25),

    // Native USDC on Base — the fund token for claim-refund transfers.
    usdcAddress: process.env.CROO_USDC_ADDRESS ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',

    // Base RPC used to verify on-chain claim proofs (default: public Base RPC).
    proofRpcUrl: process.env.CROO_PROOF_RPC_URL ?? process.env.CROO_RPC_URL ?? 'https://mainnet.base.org',
    // CROO settles orders as ERC-4337 UserOperations through this EntryPoint,
    // so a genuine order tx is always sent to it — a fabricated hash isn't.
    entryPoint: (process.env.CROO_ENTRYPOINT ?? '0x0000000071727de22e5e9d8baf0edac6f37da032').toLowerCase(),
  },

  // Underwriting & claims parameters (USDC, human units).
  insurance: {
    // What our three services charge. In croo mode the real store prices
    // (read from the public API) override these display defaults.
    prices: {
      insure: Number(process.env.INSURE_PRICE ?? 0.05),
      claim: Number(process.env.CLAIM_PRICE ?? 0.01),
      certificate: Number(process.env.CERTIFICATE_PRICE ?? 0.05),
    },
    // Capital the insurer itself stakes into the reserve pool (USDC).
    seedCapital: Number(process.env.SEED_CAPITAL ?? 5),
    // Hard cap on any single policy's coverage.
    maxCoverage: Number(process.env.MAX_COVERAGE ?? 1.0),

    // ---- Value-based pricing ----
    // Coverage is tied to the VALUE AT RISK (the price of the insured service),
    // risk-adjusted, but never more than `coverageMultiple` × the premium — so a
    // tiny premium can't buy huge cover. Expensive hires need a higher tier.
    coverageMultiple: Number(process.env.COVERAGE_MULTIPLE ?? 10),
    // Share of the insured service's price we'll cover, by risk band.
    coverageShare: {
      low: Number(process.env.COVERAGE_SHARE_LOW ?? 1.0),
      medium: Number(process.env.COVERAGE_SHARE_MEDIUM ?? 0.7),
      high: Number(process.env.COVERAGE_SHARE_HIGH ?? 0.4),
    },
    // Suggested premium when quoting: a % of the insured service's price,
    // with a floor that must exceed our per-claim adjudication cost.
    premiumRate: Number(process.env.PREMIUM_RATE ?? 0.15),
    premiumFloor: Number(process.env.PREMIUM_FLOOR ?? 0.05),
    // Policy lifetime in hours.
    policyHours: Number(process.env.POLICY_HOURS ?? 24),
    // Payout requires at least this adjudication confidence.
    minPayoutConfidence: Number(process.env.MIN_PAYOUT_CONFIDENCE ?? 0.5),
  },

  // Hiring third-party specialists from the CROO Agent Store.
  external: {
    enabled: (process.env.EXTERNAL_HIRES ?? 'on') !== 'off',
    // Give up on an unresponsive provider after this long. The full on-chain
    // order lifecycle (accept → create → pay → deliver) can take ~90-120s, so
    // anything under that strangles legitimate hires.
    orderTimeoutMs: Number(process.env.EXTERNAL_ORDER_TIMEOUT_MS ?? 150_000),

    // Only hire agents whose completion rate is at least this (0-100).
    minCompletionRate: Number(process.env.MIN_COMPLETION_RATE ?? 95),
    // Never pay an external specialist more than this per call (USDC).
    verifierMaxPrice: Number(process.env.VERIFIER_MAX_PRICE ?? 0.1),
    trustMaxPrice: Number(process.env.TRUST_MAX_PRICE ?? 0.1),
    payoutMaxPrice: Number(process.env.PAYOUT_MAX_PRICE ?? 0.1),
    // Skip our own sibling agents to avoid self-trade patterns.
    excludeAgentIds: (process.env.EXTERNAL_EXCLUDE_AGENT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Optionally pin exact store serviceIds (else auto-discovered by keyword).
    pinnedVerifierServiceId: process.env.VERIFIER_SERVICE_ID ?? '',
    pinnedTrustServiceId: process.env.TRUST_SERVICE_ID ?? '',
    pinnedPayoutServiceId: process.env.PAYOUT_SERVICE_ID ?? '',
  },
};
