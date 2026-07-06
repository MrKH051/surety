# Surety — Demo Day Live Presentation Script (~3 min)

## Before you start — open these tabs
1. Live dashboard: http://77.90.6.77:3100
2. Basescan refund tx: https://basescan.org/tx/0x9932e932bd8150a5ffd11f2d602cf22db39cf300c206f2dffd7c0b9cab12a91c
3. GitHub: https://github.com/MrKH051/surety

Check the Surety wallet has USDC (needs > $1 for a live refund). Have the recorded
4-min video ready as Plan B if the live run stalls.

---

### 1) Hook (15s) — show the dashboard home
> "Hi, I'm building Surety. Here's a problem nobody in the agent economy talks about:
> escrow guarantees that a delivery *happens* — it does NOT guarantee the delivery is
> any *good*. Your agent pays another agent, gets garbage back, and the money is just gone."

### 2) Solution (20s) — point at the agent network nodes
> "Surety is delivery insurance for AI agents. You insure a hire before you pay for it.
> If the delivery fails, an INDEPENDENT agent from another team judges it — never the
> seller itself — and you get refunded automatically, in real USDC on Base."

### 3) LIVE DEMO (90s) — click "Demo: failed delivery → refund", then narrate
> "Let me show you a real run. A customer insures a hire… the policy is bound, priced
> from live marketplace data plus a trust report Surety BUYS from another team."
>
> (when the verifier is hired:) "The delivery came back bad, so a claim is filed. Watch —
> Surety hires an INDEPENDENT verifier from another team to judge it…"
>
> (verdict UNSATISFIED:) "Verdict: unsatisfied. The claim is approved…"
>
> (refund paid:) "…and the refund is sent automatically by hiring an on-chain PAYMENT
> agent. That's one insured job touching FOUR agents from FOUR different teams — all
> settling in USDC."
>
> (switch to the Basescan tab:) "And this isn't a mock-up. Here's a real refund we paid
> on Base mainnet — a real transaction hash, on-chain."

### 4) Why it's impossible on Web2 (20s)
> "You literally cannot build this on a normal API marketplace. Insurance needs three
> things only CAP gives you: verifiable on-chain settlement, portable agent identity so
> risk scores mean something, and composability — the verifier and the payment rail are
> themselves paid agents I hire per claim. On CAP, the whole insurance lifecycle is just
> agents hiring agents."

### 5) Traction & close (15s) — show Policy book / Claims panel
> "Surety is live 24/7, fully open-source. It's already completed over twenty real orders,
> from five different buyer wallets, buying from four different teams. Insure your next
> hire — and let it fail safely. Thank you."

---

## Q&A — likely judge questions

**Is the independent verifier really unbiased?**
> "Two safeguards: the verifier is always from a different team than the seller being
> disputed — I explicitly exclude the seller's own agent — and it's hired fresh per claim,
> so there's no standing relationship to game."

**What if the reserve pool runs dry?**
> "There's a solvency guard: Surety never promises more coverage than half its reserve
> float can actually pay. Premiums fund the pool, and coverage scales with risk."

**How do you stop insurance fraud (a fake claim on a good delivery)?**
> "The claim is judged against the exact acceptance contract the buyer set at purchase
> time, by an independent agent — a frivolous claim on a good delivery gets a 'satisfied'
> verdict and no payout."

**Why is this better than bonding / KOANE?**
> "Bonding makes the seller lock capital upfront, which most agents won't do. Insurance
> moves the cost to a tiny premium on the buyer side — it's opt-in, cheap, and needs zero
> cooperation from the seller. And we've actually paid a real claim on-chain."

**How many real orders?**
> "Over twenty completed orders, five unique buyer wallets, and I buy from four different
> teams — so it clears the anti-sybil bar on both counterparty and buyer diversity."

---

## Delivery tips
- Speak slowly and confidently; sentences are kept short on purpose.
- Rehearse the live demo 2-3 times; make sure the wallet is funded and the dashboard is up.
- Plan B: if the live server stalls, play the recorded 4-min video.
- Biggest moment: showing Basescan. Pause there and let it land — that's what sets you apart.

---

## Short versions (if you present all three)

### Megaphone (~45s)
> "Most agents on the store get zero orders — the agent economy has no marketing layer.
> Megaphone is that layer. Give it your listing, and it audits it against every competitor
> on the store, rewrites your name and description, generates a launch banner, and even
> hires other agents to fact-check the copy and publish it. One order, a whole marketing
> supply chain — every step a real A2A transaction."

### Research Desk (~45s)
> "Ask one question, and Atlas — the orchestrator — hires and pays a whole editorial team
> on-chain: a researcher, a second-opinion researcher from ANOTHER team, a writer, and a
> fact-checker. Every step is a real escrow order on Base. You get back a cited report with
> a confidence score — a small, working agent-to-agent economy."
