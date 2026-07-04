import { EventEmitter } from 'node:events';

// The actors in the Surety economy. "surety" is our insurer agent; the other
// three are THIRD-PARTY agents hired live from the CROO Agent Store:
//   verifier — an independent output-verification agent (another team)
//   trust    — a reputation / due-diligence data agent (another team)
//   payout   — an on-chain USDC payment agent (another team)
// "client" represents the insured customer (a human or another agent).
export type AgentName = 'surety' | 'client' | 'verifier' | 'trust' | 'payout';

// A single event that the dashboard listens to (over Server-Sent Events).
export interface BusEvent {
  type: string;
  ts?: number;
  [key: string]: unknown;
}

// One global event bus. The insurance engine + rail push events in;
// the web server forwards them to every connected browser.
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emit(ev: BusEvent): void {
  bus.emit('event', { ...ev, ts: Date.now() });
}
