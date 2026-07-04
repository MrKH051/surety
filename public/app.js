// ---------- SVG icons (crisp, no external assets) ----------
const ICON = {
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6Z"/><path d="m9 12 2 2 4-4"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="#8fb8ac" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`,
  scale: `<svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M8 21h8"/><path d="m5 7 14 0"/><path d="M5 7 3 12c0 1.7 1.3 3 3 3s3-1.3 3-3L7 7"/><path d="m19 7-2 5c0 1.7 1.3 3 3 3s3-1.3 3-3l-2-5" transform="translate(-2 0)"/></svg>`,
  radar: `<svg viewBox="0 0 24 24" fill="none" stroke="#f7c948" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/></svg>`,
  coins: `<svg viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="5.5"/><path d="M14.8 5.6a5.5 5.5 0 1 1-6.5 8.6"/><path d="M7 8h4M9 6v4"/></svg>`,
};

const LOGO = `<svg viewBox="0 0 48 48" fill="none"><defs><linearGradient id="lg" x1="0" y1="0" x2="48" y2="48"><stop stop-color="#34d399"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><path d="M24 3 42 10v12c0 10-7.5 17.5-18 23C13.5 39.5 6 32 6 22V10Z" stroke="url(#lg)" stroke-width="2.5" fill="rgba(52,211,153,0.08)"/><path d="m16 23 5.5 5.5L33 17" stroke="url(#lg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- agent definitions ----------
const AGENTS = {
  client:   { name: "Insured customer", role: "Human or agent · buys cover before hiring", icon: ICON.user, pill: "Customer", bal: false },
  surety:   { name: "Surety", role: "Insurer · underwrites, adjudicates, refunds", icon: ICON.shield, pill: "Underwriter", bal: true },
  trust:    { name: "Trust data agent", role: "3rd-party · reputation report for pricing", icon: ICON.radar, pill: "Store hire", bal: true },
  verifier: { name: "Verification agent", role: "3rd-party · independent claim verdict", icon: ICON.scale, pill: "Store hire", bal: true },
  payout:   { name: "Payment agent", role: "3rd-party · sends USDC refunds on Base", icon: ICON.coins, pill: "Store hire", bal: true },
};

const nameOf = (id, ev) => (ev?.toName && id === ev.to ? ev.toName : (AGENTS[id]?.name ?? id));

// When a real third-party agent gets hired, show its actual name on the node.
function labelNode(id, name) {
  if (!name) return;
  const el = document.querySelector(`#node-${id} .node-name`);
  if (el) el.textContent = name.length > 26 ? name.slice(0, 26) + "…" : name;
}

// ---------- build nodes ----------
document.getElementById("logoSlot").innerHTML = LOGO;

for (const [id, a] of Object.entries(AGENTS)) {
  const el = document.getElementById("node-" + id);
  if (!el) continue;
  el.innerHTML = `
    ${a.pill ? `<span class="role-pill">${a.pill}</span>` : ""}
    <div class="node-ico">${a.icon}</div>
    <div class="node-body">
      <div class="node-name">${a.name}</div>
      <div class="node-role">${a.role}</div>
      ${a.bal ? `<div class="node-bal" data-bal>0.00 <span>USDC</span></div>` : ""}
      <div class="node-state" data-state></div>
    </div>`;
}

function setBalance(id, balance) {
  const el = document.querySelector(`#node-${id} [data-bal]`);
  if (el) el.innerHTML = `${(+balance).toFixed(2)} <span>USDC</span>`;
}
function setState(id, state) {
  const node = document.getElementById("node-" + id);
  if (!node) return;
  node.classList.toggle("working", state === "working");
  node.classList.add("active");
  const el = node.querySelector("[data-state]");
  if (el) el.textContent = state === "working" ? "● working…" : "";
}
function flashPaid(id) {
  const node = document.getElementById("node-" + id);
  if (!node) return;
  node.classList.add("paid", "active");
  setTimeout(() => node.classList.remove("paid"), 1400);
}

// ---------- flying coin animation ----------
function flyCoin(fromId, toId) {
  const a = document.getElementById("node-" + fromId);
  const b = document.getElementById("node-" + toId);
  if (!a || !b) return;
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const x0 = ra.left + ra.width / 2 - 15;
  const y0 = ra.top + ra.height / 2 - 15;
  const coin = document.createElement("div");
  coin.className = "coin";
  coin.textContent = "$";
  coin.style.left = x0 + "px";
  coin.style.top = y0 + "px";
  document.getElementById("coinLayer").appendChild(coin);
  requestAnimationFrame(() => {
    const dx = rb.left + rb.width / 2 - 15 - x0;
    const dy = rb.top + rb.height / 2 - 15 - y0;
    coin.style.transform = `translate(${dx}px, ${dy}px) scale(0.65)`;
    coin.style.opacity = "0.15";
  });
  setTimeout(() => coin.remove(), 1200);
}

// ---------- transaction feed ----------
const feedEl = document.getElementById("feed");
function addFeed(o) {
  const tx = o.txHash
    ? `<a class="tx-link" href="https://basescan.org/tx/${o.txHash}" target="_blank" title="${o.txHash}">⛓ tx</a>`
    : "";
  const li = document.createElement("li");
  li.innerHTML = `
    <span class="phase ${o.phase}">${o.phase}</span>
    <span class="who">${nameOf(o.from, o)} → ${nameOf(o.to, o)}</span>
    <span class="cap">${o.capability || ""}</span>
    ${tx}
    <span class="tx-amount">${(+o.amount).toFixed(2)} USDC</span>`;
  feedEl.prepend(li);
  while (feedEl.children.length > 80) feedEl.removeChild(feedEl.lastChild);
}

// ---------- stats & books ----------
const setStat = (id, v) => (document.getElementById(id).textContent = v);
const policies = new Map(); // policyId -> policy
const claims = new Map(); // claimId -> claim

function fmtUsd(n) {
  return (+n).toFixed(Math.abs(+n) < 1 ? 3 : 2);
}

function renderPool(pool, float) {
  setStat("statFloat", fmtUsd(float));
  setStat("statPremiums", fmtUsd(pool.premiums));
  setStat("statPayouts", fmtUsd(pool.payouts));
}

function renderPolicies() {
  const el = document.getElementById("policyList");
  const list = [...policies.values()].sort((a, b) => b.createdAt - a.createdAt);
  setStat("statActive", list.filter((p) => p.status === "active").length);
  if (!list.length) {
    el.innerHTML = `<p class="placeholder">No policies yet — run a demo or insure a hire above.</p>`;
    return;
  }
  el.innerHTML = list
    .slice(0, 40)
    .map(
      (p) => `
    <li>
      <div class="row1">
        <span class="mono">${p.policyId}</span>
        <span class="tag ${p.riskBand}">${p.riskBand} ${p.riskScore}</span>
        <span class="grow" title="${escapeHtml(p.insuredServiceName)}">${escapeHtml(p.insuredServiceName)}</span>
        <span class="tag ${p.status}">${p.status.replace("_", " ")}</span>
      </div>
      <div class="sub">
        premium <span class="amount">${fmtUsd(p.premium)}</span> →
        coverage <span class="amount">${fmtUsd(p.coverage)}</span> USDC
        · ${escapeHtml(p.requirements.slice(0, 90))}${p.requirements.length > 90 ? "…" : ""}
      </div>
    </li>`,
    )
    .join("");
}

function renderClaims() {
  const el = document.getElementById("claimList");
  const list = [...claims.values()].sort((a, b) => b.filedAt - a.filedAt);
  if (!list.length) {
    el.innerHTML = `<p class="placeholder">No claims yet — the "failed delivery" demo files one automatically.</p>`;
    return;
  }
  el.innerHTML = list
    .slice(0, 40)
    .map((c) => {
      const refund =
        c.payout && c.payout.status !== "none"
          ? `refund <span class="amount">${fmtUsd(c.payout.amount)}</span> USDC (${c.payout.status}${c.payout.via ? ` via ${escapeHtml(c.payout.via)}` : ""})`
          : "no payout";
      const verifier = c.externalVerifier
        ? ` · 2nd opinion: ${escapeHtml(c.externalVerifier.serviceName)}`
        : "";
      return `
    <li>
      <div class="row1">
        <span class="mono">${c.claimId}</span>
        <span class="tag ${c.verdict}">${c.verdict}</span>
        <span class="grow"></span>
        <span class="mono">${Math.round((c.confidence ?? 0) * 100)}%</span>
      </div>
      <div class="sub">${refund}${verifier}<br/>${escapeHtml((c.rationale || "").slice(0, 140))}</div>
    </li>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------- non-blocking toast (never use alert(): it freezes the demo) ----------
function toast(message, ms = 6000) {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.style.cssText =
      "position:fixed;right:18px;bottom:18px;z-index:99;display:flex;flex-direction:column;gap:8px;max-width:380px;";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.style.cssText =
    "background:rgba(16,38,42,0.95);border:1px solid rgba(110,200,180,0.3);color:#e9fbf4;" +
    "padding:12px 14px;border-radius:12px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;" +
    "box-shadow:0 18px 50px rgba(0,0,0,0.45);";
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- SSE ----------
const es = new EventSource("/api/events");
es.onmessage = (msg) => {
  let ev;
  try { ev = JSON.parse(msg.data); } catch { return; }

  switch (ev.type) {
    case "balance": setBalance(ev.agent, ev.balance); break;
    case "agent": setState(ev.agent, ev.state); break;
    case "order":
      addFeed(ev);
      if (ev.toName) labelNode(ev.to, ev.toName);
      if (ev.phase === "lock") flyCoin(ev.from, ev.to);
      if (ev.phase === "clear") flashPaid(ev.to);
      break;
    case "policy":
      policies.set(ev.policy.policyId, ev.policy);
      renderPolicies();
      prefillClaim(ev.policy);
      break;
    case "claim":
      claims.set(ev.claim.claimId, ev.claim);
      renderClaims();
      break;
    case "pool": renderPool(ev.pool, ev.float); break;
    case "demo": if (ev.phase !== "start") setBusy(false); break;
    case "log":
      if (ev.level === "error") console.error("[server]", ev.message);
      break;
  }
};

// Convenience: after a policy binds, put its id into the claim form.
function prefillClaim(policy) {
  const el = document.getElementById("claimPolicy");
  if (el && !el.value.trim()) el.value = policy.policyId;
}

// ---------- buttons ----------
const buttons = ["demoBadBtn", "demoGoodBtn", "insureBtn", "certBtn", "claimBtn"].map((id) =>
  document.getElementById(id),
);
function setBusy(busy) {
  for (const b of buttons) b.disabled = busy;
}

async function post(url, body) {
  setBusy(true);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "request failed");
    return data;
  } catch (err) {
    toast("⚠️ " + err.message);
    throw err;
  } finally {
    setBusy(false);
  }
}

document.getElementById("demoBadBtn").addEventListener("click", () => {
  setBusy(true);
  post("/api/demo/bad").catch(() => {});
});
document.getElementById("demoGoodBtn").addEventListener("click", () => {
  setBusy(true);
  post("/api/demo/good").catch(() => {});
});

document.getElementById("insureBtn").addEventListener("click", () => {
  const serviceId = document.getElementById("insureService").value.trim();
  const requirements = document.getElementById("insureReq").value.trim();
  const payoutAddress = document.getElementById("insureWallet").value.trim();
  if (!serviceId || !requirements) return toast("serviceId and requirements are both needed.");
  post("/api/insure", { serviceId, requirements, ...(payoutAddress ? { payoutAddress } : {}) }).catch(() => {});
});

document.getElementById("certBtn").addEventListener("click", () => {
  const serviceId = document.getElementById("insureService").value.trim();
  if (!serviceId) return toast("Enter the store serviceId to assess.");
  post("/api/certificate", { serviceId })
    .then((cert) => toast(`Risk certificate — ${cert.serviceName ?? cert.serviceId}\n\nScore: ${cert.riskScore}/100 (${cert.riskBand})\n\n${cert.summary}`, 12000))
    .catch(() => {});
});

document.getElementById("claimBtn").addEventListener("click", () => {
  const policyId = document.getElementById("claimPolicy").value.trim();
  const deliverable = document.getElementById("claimDeliverable").value.trim();
  if (!policyId || !deliverable) return toast("policyId and the deliverable are both needed.");
  post("/api/claim", { policyId, deliverable }).catch(() => {});
});

// ---------- initial snapshot & status badges ----------
fetch("/api/state")
  .then((r) => r.json())
  .then((s) => {
    for (const p of s.policies ?? []) policies.set(p.policyId, p);
    for (const c of s.claims ?? []) claims.set(c.claimId, c);
    renderPolicies();
    renderClaims();
    renderPool(s.pool ?? { premiums: 0, payouts: 0, costs: 0 }, s.float ?? 0);
  })
  .catch(() => {});

fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    const rail = document.getElementById("railBadge");
    if (s.rail === "croo") { rail.textContent = "LIVE on Base"; rail.classList.add("live"); }
    else rail.textContent = "🧪 Simulation";
    document.getElementById("llmBadge").textContent = "🧠 " + s.llm;
  })
  .catch(() => {});
