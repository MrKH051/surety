import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { bus, emit, type BusEvent } from './bus.js';
import type { PaymentRail, SoldServiceKind } from './rail/types.js';
import { SimulatedRail } from './rail/sim.js';
import { buildSoldServices } from './services.js';
import { getPool, listClaims, listPolicies, poolFloat } from './core/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Pick and wire up the active payment rail ----
async function buildRail(): Promise<PaymentRail> {
  let rail: PaymentRail;
  if (config.rail === 'croo') {
    const { CrooRail } = await import('./rail/croo.js'); // lazy: only load SDK in croo mode
    rail = new CrooRail();
  } else {
    rail = new SimulatedRail();
  }
  rail.setSoldServices(buildSoldServices(() => rail, config.insurance.prices));
  await rail.init();
  return rail;
}

/**
 * Run one of our sold services as if a customer bought it on the store —
 * with the full escrow story on the dashboard. This powers the demo buttons
 * and the manual forms; in croo mode real store orders arrive over the
 * websocket instead and use the exact same handlers.
 */
async function customerPurchase(
  rail: PaymentRail,
  kind: SoldServiceKind,
  input: unknown,
): Promise<unknown> {
  const price = config.insurance.prices[kind];
  const capability = { insure: 'insurance.bind', claim: 'insurance.claim', certificate: 'insurance.certificate' }[kind];
  const orderId = 'ui_' + Math.random().toString(36).slice(2, 10);
  const phase = (p: string) =>
    emit({ type: 'order', orderId, from: 'client', to: 'surety', capability, amount: price, phase: p });

  phase('negotiate');
  await sleep(300);
  phase('accept');
  await sleep(250);
  if (config.rail === 'sim') rail.deduct('client', price);
  phase('lock');

  const handlers = buildSoldServices(() => rail, config.insurance.prices);
  const result = await handlers[kind](input, orderId);

  phase('deliver');
  phase('clear');
  return result;
}

// ---- The two scripted demos (same code path as real orders) ----

const DEMO_REQUIREMENTS =
  'Write a 5-bullet market brief about the USDC stablecoin ecosystem on Base, with at least two cited sources and one risk caveat.';

const DEMO_GOOD_DELIVERY = [
  'Market brief — USDC stablecoin ecosystem on Base:',
  '• USDC is the dominant stablecoin on Base, powering most onchain commerce pairs [1].',
  '• Native USDC issuance replaced bridged USDbC, simplifying liquidity for builders [2].',
  '• Payment-agent protocols settle micro-transactions in USDC escrow on Base.',
  '• Weekly active addresses interacting with USDC contracts keep growing.',
  '• Risk caveat: issuer concentration means depeg or freeze events remain a systemic risk.',
  'Sources: [1] basescan.org analytics, [2] Circle announcement.',
].join('\n');

const DEMO_BAD_DELIVERY =
  'Hello! Here is your horoscope for today. Mercury is in retrograde so great things await you. Thanks for your purchase, no refunds.';

async function runDemo(rail: PaymentRail, outcome: 'good' | 'bad'): Promise<void> {
  emit({ type: 'demo', phase: 'start', outcome });
  emit({
    type: 'log',
    level: 'info',
    message: `Demo: a customer insures a hire, receives a ${outcome} delivery, and files a claim.`,
  });

  // 1) The customer buys cover for the job before hiring the agent.
  const policyOut = (await customerPurchase(rail, 'insure', {
    serviceId: 'demo_translation_agent',
    requirements: DEMO_REQUIREMENTS,
    payoutAddress: '0xC0FFEE000000000000000000000000000000cafe',
  })) as { policyId: string };

  await sleep(700);

  // 2) The delivery arrives (good or bad) and the customer files a claim.
  const claimOut = await customerPurchase(rail, 'claim', {
    policyId: policyOut.policyId,
    deliverable: outcome === 'good' ? DEMO_GOOD_DELIVERY : DEMO_BAD_DELIVERY,
  });

  emit({ type: 'demo', phase: 'done', outcome, policy: policyOut, claim: claimOut });
}

async function main() {
  const rail = await buildRail();
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Tell the UI which rail is live and whether a real AI brain is configured.
  app.get('/api/status', (_req, res) => {
    res.json({
      rail: config.rail,
      railName: rail.name,
      llm: `${config.llm.model} @ ${new URL(config.llm.baseUrl).host}`,
      prices: config.insurance.prices,
    });
  });

  // Snapshot for first render; live updates stream over SSE.
  app.get('/api/state', (_req, res) => {
    res.json({
      policies: listPolicies(),
      claims: listClaims(),
      pool: getPool(),
      float: poolFloat(),
    });
  });

  // Server-Sent Events: stream every bus event to connected browsers.
  app.get('/api/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);

    const listener = (ev: BusEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    bus.on('event', listener);
    req.on('close', () => bus.off('event', listener));
  });

  // ---- The three products, callable from the dashboard ----

  app.post('/api/insure', async (req, res) => {
    try {
      res.json(await customerPurchase(rail, 'insure', req.body ?? {}));
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message ?? err) });
    }
  });

  app.post('/api/claim', async (req, res) => {
    try {
      res.json(await customerPurchase(rail, 'claim', req.body ?? {}));
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message ?? err) });
    }
  });

  app.post('/api/certificate', async (req, res) => {
    try {
      res.json(await customerPurchase(rail, 'certificate', req.body ?? {}));
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message ?? err) });
    }
  });

  // ---- Scripted end-to-end demos ----
  app.post('/api/demo/:outcome', (req, res) => {
    const outcome = req.params.outcome === 'good' ? 'good' : 'bad';
    runDemo(rail, outcome).catch((err) => {
      emit({ type: 'demo', phase: 'error', message: String(err?.message ?? err) });
      emit({ type: 'log', level: 'error', message: String(err?.message ?? err) });
    });
    res.json({ ok: true });
  });

  app.listen(config.port, () => {
    console.log(`\n  Surety is on duty:  http://localhost:${config.port}`);
    console.log(`  Payment rail: ${rail.name}`);
    console.log(`  AI brain:     ${config.llm.model} @ ${config.llm.baseUrl}\n`);
  });
}

main().catch((err) => {
  console.error('Failed to start Surety:', err);
  process.exit(1);
});
