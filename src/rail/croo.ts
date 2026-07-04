import { config } from '../config.js';
import { emit, type AgentName } from '../bus.js';
import type {
  HireRequest,
  HireResult,
  PaymentRail,
  SoldServiceHandler,
  SoldServiceKind,
} from './types.js';

/**
 * THE REAL RAIL — CROO Agent Protocol on Base.
 *
 * Surety is a single agent profile that plays BOTH sides of the market:
 *
 *   • SELLER — lists three services (Insure a Hire / File a Claim / Agent
 *     Risk Certificate), auto-accepts negotiations, and fulfils paid orders.
 *   • BUYER  — hires third-party specialists (verification, trust data,
 *     USDC payouts) from other teams on the store, via real escrow.
 *
 * Lifecycle (from the SDK docs):
 *   buyer.negotiateOrder(serviceId) → provider.acceptNegotiation()
 *     → buyer gets OrderCreated → buyer.payOrder()
 *     → provider gets OrderPaid → provider.deliverOrder()
 *     → buyer gets OrderCompleted → buyer.getDelivery()
 */

interface Pending {
  to: AgentName;
  toName?: string;
  capability: string;
  price: number;
  orderId?: string;
  resolve: (r: HireResult) => void;
  reject: (e: Error) => void;
}

const CAPABILITY_BY_KIND: Record<SoldServiceKind, string> = {
  insure: 'insurance.bind',
  claim: 'insurance.claim',
  certificate: 'insurance.certificate',
};

export class CrooRail implements PaymentRail {
  readonly name = 'CROO Agent Protocol (Base)';

  private sdk: any;
  private client: any;
  private stream: any;

  private soldServices?: Record<SoldServiceKind, SoldServiceHandler>;
  private kindByServiceId = new Map<string, SoldServiceKind>();

  private pendingByNeg = new Map<string, Pending>();
  private pendingByOrder = new Map<string, Pending>();

  private balances = new Map<AgentName, number>();

  // Real per-service prices (USDC), loaded once so the feed shows true amounts.
  private servicePrices = new Map<string, number>();

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

  /** The real store price of one of our own services (for the dashboard). */
  priceOf(kind: SoldServiceKind): number | undefined {
    const id = config.croo.serviceIds[kind];
    return id ? this.servicePrices.get(id) : undefined;
  }

  async init(): Promise<void> {
    this.sdk = await import('@croo-network/sdk');
    const { AgentClient } = this.sdk;
    const cfg = {
      baseURL: config.croo.apiUrl,
      wsURL: config.croo.wsUrl,
      ...(config.croo.rpcUrl ? { rpcURL: config.croo.rpcUrl } : {}),
    };

    if (!config.croo.sdkKey) {
      throw new Error('Missing CROO_SURETY_SDK_KEY in .env (or use RAIL=sim).');
    }

    for (const kind of ['insure', 'claim', 'certificate'] as SoldServiceKind[]) {
      const id = config.croo.serviceIds[kind];
      if (id) this.kindByServiceId.set(id, kind);
    }
    if (this.kindByServiceId.size === 0) {
      emit({
        type: 'log',
        level: 'warn',
        message:
          'No CROO_*_SERVICE_ID configured — Surety will buy specialists but cannot sell yet.',
      });
    }

    this.client = new AgentClient(cfg, config.croo.sdkKey);
    this.stream = await this.client.connectWebSocket();
    this.attachBuyerHandlers();
    this.attachSellerHandlers();

    await this.loadServicePrices();

    // Seed dashboard balances (display only; real funds live on-chain).
    this.balances.set('surety', config.croo.startBalance);
    for (const a of ['client', 'verifier', 'trust', 'payout'] as AgentName[]) this.balances.set(a, 0);
    for (const [agent, balance] of this.balances) emit({ type: 'balance', agent, balance });

    emit({ type: 'log', level: 'info', message: 'Connected to CROO Agent Protocol on Base.' });
  }

  /** Fetch the real USDC price of each of our services from the public store (once). */
  private async loadServicePrices(): Promise<void> {
    const wanted = new Set(this.kindByServiceId.keys());
    if (wanted.size === 0) return;
    try {
      for (let page = 1; page <= 16 && this.servicePrices.size < wanted.size; page++) {
        const res = await fetch(
          `${config.croo.apiUrl}/backend/v1/public/services?page=${page}&page_size=50`,
          { headers: { 'X-SDK-Key': config.croo.sdkKey } },
        );
        if (!res.ok) break;
        const data = (await res.json()) as { items?: Array<{ serviceId: string; price: string }> };
        const items = data.items ?? [];
        if (items.length === 0) break;
        for (const it of items) {
          if (wanted.has(it.serviceId)) {
            this.servicePrices.set(it.serviceId, formatUsdc(it.price) ?? 0);
          }
        }
      }
    } catch {
      /* fall back to configured prices if the store is unreachable */
    }
  }

  /** Buyer side: pay when the order is created, collect when it completes. */
  private attachBuyerHandlers(): void {
    const { EventType } = this.sdk;

    this.stream.on(EventType.OrderCreated, async (e: any) => {
      const pending = e.negotiation_id ? this.pendingByNeg.get(e.negotiation_id) : undefined;
      if (!pending) return;
      const orderId = e.order_id;
      pending.orderId = orderId;
      if (orderId) this.pendingByOrder.set(orderId, pending);

      // Read the real on-chain price (USDC, 6 decimals) so the dashboard
      // shows the actual amount instead of a placeholder.
      try {
        const order = await this.client.getOrder(orderId);
        const realPrice = formatUsdc(order?.price);
        if (realPrice != null) pending.price = realPrice;
      } catch {
        /* keep placeholder price */
      }
      this.phase(pending, 'accept', orderId);

      try {
        const res = await this.client.payOrder(orderId);
        this.deduct('surety', pending.price);
        this.phase(pending, 'lock', orderId, res?.txHash);
      } catch (err) {
        this.fail(pending, err);
      }
    });

    this.stream.on(EventType.OrderCompleted, async (e: any) => {
      const pending = e.order_id ? this.pendingByOrder.get(e.order_id) : undefined;
      if (!pending) return;
      try {
        const delivery = await this.client.getDelivery(e.order_id);
        this.phase(pending, 'deliver', e.order_id);
        this.credit(pending.to, pending.price);
        this.phase(pending, 'clear', e.order_id);
        pending.resolve({
          orderId: e.order_id,
          result: safeParse(delivery?.deliverableText),
          price: pending.price,
        });
        this.cleanup(pending);
      } catch (err) {
        this.fail(pending, err);
      }
    });

    this.stream.on(EventType.OrderRejected, (e: any) => {
      const pending = e.order_id ? this.pendingByOrder.get(e.order_id) : undefined;
      if (pending) this.fail(pending, new Error(`Order rejected: ${e.reason ?? 'unknown'}`));
    });

    // A provider can refuse before any order exists — fail fast instead of
    // burning the whole hire timeout waiting for an order that never comes.
    this.stream.on(EventType.NegotiationRejected, (e: any) => {
      const pending = e.negotiation_id ? this.pendingByNeg.get(e.negotiation_id) : undefined;
      if (pending) this.fail(pending, new Error('Negotiation rejected by the provider.'));
    });
  }

  /**
   * Seller side: when an external buyer (a human on the store, or another
   * agent) pays for one of Surety's services, fulfil it with the matching
   * product handler and deliver the JSON result.
   */
  private attachSellerHandlers(): void {
    const { EventType, DeliverableType } = this.sdk;

    // Auto-accept incoming negotiations for our own services only.
    this.stream.on(EventType.NegotiationCreated, async (e: any) => {
      const kind = e.service_id ? this.kindByServiceId.get(e.service_id) : undefined;
      if (!kind) return;
      try {
        emit({
          type: 'order',
          orderId: '',
          from: 'client',
          to: 'surety',
          capability: CAPABILITY_BY_KIND[kind],
          amount: this.priceOf(kind) ?? config.insurance.prices[kind],
          phase: 'negotiate',
        });
        await this.client.acceptNegotiation(e.negotiation_id);
      } catch (err) {
        emit({ type: 'log', level: 'error', message: `Surety accept failed: ${String(err)}` });
      }
    });

    // When the buyer pays, run the matching product and deliver.
    this.stream.on(EventType.OrderPaid, async (e: any) => {
      const orderId = e.order_id;
      try {
        const order = await this.client.getOrder(orderId);
        const kind = order?.serviceId ? this.kindByServiceId.get(order.serviceId) : undefined;
        if (!kind) return; // an order where we are the buyer, or not our service
        const price = formatUsdc(order?.price) ?? config.insurance.prices[kind];
        const input = safeParse(order?.requirements);
        const capability = CAPABILITY_BY_KIND[kind];

        const feed = (phase: string) =>
          emit({ type: 'order', orderId, from: 'client', to: 'surety', capability, amount: price, phase });

        feed('accept');
        feed('lock');

        const result = await this.soldServices![kind](input, orderId);

        await this.client.deliverOrder(orderId, {
          deliverableType: DeliverableType.Text,
          deliverableText: JSON.stringify(result),
        });
        feed('deliver');
        feed('clear');
      } catch (err) {
        emit({ type: 'log', level: 'error', message: `Surety fulfil failed: ${String(err)}` });
        // Deliver a structured error so the buyer isn't left hanging.
        try {
          await this.client.deliverOrder(orderId, {
            deliverableType: DeliverableType.Text,
            deliverableText: JSON.stringify({
              error: String((err as Error).message ?? err),
              hint: 'Check the required input fields in the service description and try again.',
            }),
          });
        } catch {
          /* nothing more we can do for this order */
        }
      }
    });
  }

  async hire(req: HireRequest): Promise<HireResult> {
    const { to, capability, input, price } = req;
    const serviceId = req.serviceId;
    if (!serviceId) {
      throw new Error(`Missing store serviceId for external ${to} hire.`);
    }

    return new Promise<HireResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(pending, new Error(`Order to ${req.toName ?? to} timed out.`));
      }, config.external.orderTimeoutMs);

      const pending: Pending = {
        to,
        toName: req.toName,
        capability,
        price: this.servicePrices.get(serviceId) ?? price,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };

      this.phase(pending, 'negotiate');
      this.client
        .negotiateOrder({ serviceId, requirements: JSON.stringify(input) })
        .then((neg: any) => this.pendingByNeg.set(neg.negotiationId, pending))
        .catch((err: unknown) => this.fail(pending, err));
    });
  }

  // ---- helpers ----

  private phase(p: Pending, phase: string, orderId?: string, txHash?: string): void {
    emit({
      type: 'order',
      orderId: orderId ?? '',
      from: 'surety',
      to: p.to,
      ...(p.toName ? { toName: p.toName } : {}),
      capability: p.capability,
      amount: p.price,
      phase,
      ...(txHash ? { txHash } : {}),
    });
  }

  private fail(p: Pending, err: unknown): void {
    p.reject(err instanceof Error ? err : new Error(String(err)));
    this.cleanup(p);
  }

  private cleanup(p: Pending): void {
    for (const [k, v] of this.pendingByNeg) if (v === p) this.pendingByNeg.delete(k);
    for (const [k, v] of this.pendingByOrder) if (v === p) this.pendingByOrder.delete(k);
  }

  async shutdown(): Promise<void> {
    try {
      this.stream?.close();
    } catch {
      /* ignore */
    }
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function safeParse(value: unknown): any {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Convert a USDC base-units string (6 decimals) into a human number, e.g. "10000" -> 0.01. */
function formatUsdc(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 1_000_000) * 1e6) / 1e6;
}
