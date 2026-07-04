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
    // Policy lifetime in hours.
    policyHours: Number(process.env.POLICY_HOURS ?? 24),
    // Payout requires at least this adjudication confidence.
    minPayoutConfidence: Number(process.env.MIN_PAYOUT_CONFIDENCE ?? 0.5),
  },

  // Hiring third-party specialists from the CROO Agent Store.
  external: {
    enabled: (process.env.EXTERNAL_HIRES ?? 'on') !== 'off',
    // Give up on an unresponsive provider after this long (many listed
    // agents are simply offline; waiting 3 minutes each kills our SLA).
    orderTimeoutMs: Number(process.env.EXTERNAL_ORDER_TIMEOUT_MS ?? 60_000),
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
