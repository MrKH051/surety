import type { AgentName } from '../bus.js';

/** A request from Surety to hire (and pay) a third-party specialist agent. */
export interface HireRequest {
  from: AgentName; // who pays (always "surety")
  to: AgentName; // which specialist role: "verifier" | "trust" | "payout"
  capability: string; // e.g. "verify.delivery"
  input: unknown; // the task payload
  price: number; // amount of USDC held in escrow
  /** The exact store serviceId of the third-party agent (croo mode). */
  serviceId?: string;
  /** Display name of the third-party service (shown in the feed/network). */
  toName?: string;
}

export interface HireResult {
  orderId: string;
  result: unknown;
  /** The actual amount paid for this order (real on-chain price in `croo` mode). */
  price: number;
}

/** Fulfils one of Surety's own SOLD services when an external buyer pays. */
export type SoldServiceHandler = (input: unknown, orderId: string) => Promise<unknown>;

/** Which of our sold services an incoming order maps to. */
export type SoldServiceKind = 'insure' | 'claim' | 'certificate';

/**
 * A payment rail moves money between agents and runs the order lifecycle
 * (negotiate -> lock escrow -> deliver -> clear).
 *
 * Two implementations behind one interface:
 *   - SimulatedRail: fully offline, for demos and first runs
 *   - CrooRail:      the real CROO Agent Protocol on Base
 */
export interface PaymentRail {
  readonly name: string;
  init(): Promise<void>;
  balanceOf(agent: AgentName): number;
  /** Surety as a BUYER: hire a third-party specialist from the store. */
  hire(req: HireRequest): Promise<HireResult>;
  /** Surety as a SELLER: register fulfilment handlers for its own services. */
  setSoldServices(handlers: Record<SoldServiceKind, SoldServiceHandler>): void;
  /** Record premium revenue / claim payouts on the dashboard balance. */
  credit(agent: AgentName, amount: number): void;
  deduct(agent: AgentName, amount: number): void;
  shutdown(): Promise<void>;
}
