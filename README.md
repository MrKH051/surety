# Surety — Delivery Insurance for the AI Agent Economy

> When one agent pays another and the delivery is garbage, the money is just gone.
> **Surety is the missing trust layer: insure the hire, verify the claim, refund automatically in USDC.**
> Built for the **CROO Agent Hackathon** on the [CROO Agent Protocol](https://croo.network) (Base).

## Demo

▶️ **[Watch the demo video](demo/surety-demo.mp4)** — every order placed on the real
CROO Agent Store: a risk certificate is issued, a hire is insured, a bad delivery is
claimed, an independent verifier from another team judges it, and a **$1.00 USDC refund
lands in the customer's wallet on Base** — fully automatic.

The agent economy has escrow (pay → deliver → clear), but escrow only guarantees *a*
delivery — not a *good* one. Surety sells insurance against exactly that gap, and it
settles every step of its own business as **agent-to-agent commerce**:

```
                 ┌──────────────────────────────┐
  customer ─────▶│           SURETY             │   premium in (USDC escrow)
  (human or      │ underwrites · adjudicates ·  │
   another agent)│          refunds             │
                 └───┬──────────┬──────────┬────┘
                     │ hires    │ hires    │ hires   (all from OTHER teams,
                     ▼          ▼          ▼          discovered live on the store)
              ┌───────────┐ ┌──────────┐ ┌──────────┐
              │ trust-data│ │ verifier │ │ payment  │
              │  agent    │ │  agent   │ │  agent   │
              │ prices the│ │ judges   │ │ sends the│
              │  premium  │ │ the claim│ │  refund  │
              └───────────┘ └──────────┘ └──────────┘
```

One insured job can generate **four A2A transactions with four different counterparties**
— premium sale, trust-data purchase, verification purchase, and even the claim refund is
executed by hiring an on-chain payment agent.

## The three products (listed on the CROO Agent Store)

| Service | Input | Output |
| --- | --- | --- |
| **Insure a Hire** | `{ serviceId, requirements, payoutAddress? }` | A bound policy: risk-priced coverage, expiry, claim instructions |
| **File a Claim** | `{ policyId, deliverable, payoutAddress? }` | Independent verdict + automatic USDC refund when the delivery failed |
| **Agent Risk Certificate** | `{ serviceId }` | Standalone underwriting report: risk score, band, indicative terms |

### How a policy is priced
1. Live marketplace signals for the target service (price, 7-day traction, description quality).
2. A reputation report **bought from another team's trust-scoring agent** (best effort).
3. An LLM refines the heuristic score (capped at ±15 so the model can't hallucinate the book).

Coverage = premium × multiplier (20× LOW / 12× MEDIUM / 6× HIGH risk), capped by
`MAX_COVERAGE` and by a **solvency guard** (never promise more than half the reserve float).

### How a claim is adjudicated
1. Surety hires an **independent verification agent from another team** for a second opinion
   (the insured agent is excluded — nobody judges their own work).
2. Surety's adjudicator (LLM + deterministic keyword-overlap fallback) issues
   `satisfied / unsatisfied / inconclusive` with a confidence score.
3. `unsatisfied` at ≥ `MIN_PAYOUT_CONFIDENCE` ⇒ the coverage is refunded by **hiring an
   on-chain USDC payment agent**. If no payment agent is available the debt is recorded
   as `owed` — nothing is ever silently dropped.

The whole book (policies, claims, reserve ledger) persists to `data/state.json`,
so a 24/7 deployment survives restarts.

## Two interchangeable payment rails

| Rail (`RAIL` env var) | What it does | When to use |
| --- | --- | --- |
| `sim` *(default)* | Faithful offline simulation of the escrow lifecycle. Specialist discovery still uses the **real store API**; execution is canned. | First run, local development, reliable demo fallback. |
| `croo` | The **real CROO Agent Protocol on Base** — real USDC escrow via `@croo-network/sdk`. | The live hackathon demo. |

Switching is a one-line change in `.env`. Same code, same dashboard, real settlement.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy the example config (optional for sim mode)
cp .env.example .env

# 3. Run it
npm start
# open http://localhost:3100
```

It runs out of the box in `sim` mode. Click **"Demo: failed delivery → refund"** to watch
the full story: policy binds → bad delivery → independent verifier says FAIL → USDC refund
flows back. The "good delivery" demo shows the claim being (correctly) denied.

For real AI underwriting/adjudication, point it at any OpenAI-compatible LLM. Easiest
free, no-key option is a local model via [Ollama](https://ollama.com):

```bash
ollama pull llama3.1     # defaults in .env.example already point at it
```

## Going live on CROO (rail = croo)

1. Create an agent profile in the [CROO dashboard](https://agent.croo.network) and grab its SDK key → `CROO_SURETY_SDK_KEY`.
2. List the three services (Insure a Hire / File a Claim / Agent Risk Certificate) and put
   their serviceIds + prices into `.env` (`CROO_*_SERVICE_ID`, `*_PRICE`).
3. Set `RAIL=croo` and restart. Incoming store orders are fulfilled by the exact same
   handlers that power the dashboard demo.

### SDK methods used

`AgentClient`, `connectWebSocket`, `negotiateOrder`, `acceptNegotiation`, `payOrder`,
`getOrder`, `deliverOrder`, `getDelivery`, plus events `NegotiationCreated`,
`NegotiationRejected`, `OrderCreated`, `OrderPaid`, `OrderCompleted`, `OrderRejected` —
and the public store API
(`/backend/v1/public/services`) for live specialist discovery.

## Run it 24/7 on a VPS

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs   # auto-restarts on crash
pm2 save && pm2 startup          # auto-starts after a reboot
```

## Configuration

Everything is tunable in `.env` — see [.env.example](.env.example) for the full list
(prices, coverage caps, policy lifetime, specialist price ceilings, pinned specialist
serviceIds, self-trade exclusion list).

## Why this is impossible on a normal API marketplace

Insurance needs three things a Web2 API marketplace can't give you: **verifiable
settlement** (the premium, the verification fee, and the refund are all real on-chain
transactions), **portable agent identity** (the risk score attaches to an on-chain
track record), and **composability** (the verifier and the payment rail are themselves
priced agents that Surety hires per claim). On CAP, the entire insurance lifecycle is
just agents hiring agents.

## License

[MIT](LICENSE)
