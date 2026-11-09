/* ============================================================
   VIEW — Live factory simulation
   A single task, animated through the real pipeline: the same
   stages the workflow defines, the same gates, the same zones.
   ============================================================ */

import { h, svgEl, esc } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, tag, tags, callout, table, kv } from "./ui.js";

const { WORKFLOWS, NODES, ZONES, EDGES, TASK_STATES, AUTONOMY, TIERS, EFFECT_CLASSES } = DATA;

/* The simulation is a scripted journey through Workflow B, with each
   stage naming the zone it happens in, the components it touches, the
   events it emits, and the checks it must pass. */

const STAGES = [
  {
    n: 1, title: "Intent recorded", zone: "Z0", nodes: ["owner", "api", "pg", "eventlog"],
    state: "DRAFT", tier: "R1", eff: "E0",
    actor: "Human", who: "The owner labels an issue",
    body: "A human acts through a typed access point. The intent lands in Postgres and two events are appended. Nothing is generated yet — intent and judgement originate only in Z0.",
    ev: ["webhook.received", "intent.recorded"],
    checks: ["Author is on the allow-list", "No agent-readable content has been executed", "Event appended in the same transaction as the state change"],
    fails: "Non-allow-listed author ⇒ intent.rejected, and nothing is created.",
    note: "There is no informal 'chat with the agent' path. Intent arrives at AP-1, typed and authorised.",
  },
  {
    n: 2, title: "Triage — classify and route", zone: "Z1", nodes: ["worker", "orch", "pg"],
    state: "TRIAGED", tier: "R1", eff: "E0",
    actor: "Agent", who: "Triage Agent (completion, cheap tier)",
    body: "The cheap model classifies the request and routes it to a workflow. It produces a verdict, not a change. The control plane decides which workflow runs — the agent does not choose.",
    ev: ["request.triaged"],
    checks: ["Classification is deterministic given the same context", "Routing is made by the definition, not the model"],
    fails: "Out of scope ⇒ REJECTED.",
    note: "Model tiering follows context scope, not prestige. A classification problem does not need a strong model.",
  },
  {
    n: 3, title: "Refinement — spec + checkable criteria", zone: "Z1", nodes: ["worker", "context", "pg"],
    state: "REFINED", tier: "R2", eff: "E0",
    actor: "Agent", who: "Refinement Agent (completion, strong tier)",
    body: "The spec is written and the acceptance criteria are expressed in a checkable form. If the criteria cannot be made checkable, the task cannot proceed — it escalates rather than continuing with vague intent.",
    ev: ["spec.refined", "spec.accepted"],
    checks: ["At least one criterion is mechanically checkable", "The spec does not presuppose a solution"],
    fails: "Not expressible as a check ⇒ ESCALATED.",
  },
  {
    n: 4, title: "Oracle construction + admission", zone: "Z1", nodes: ["worker", "context", "artifact"],
    state: "REFINED", tier: "R2", eff: "E0",
    actor: "Human / deterministic / agent", who: "The oracle is built, then admitted",
    body: "THE LOAD-BEARING STAGE. The acceptance oracle is authored against the specification — by a deterministic generator where possible, by a human otherwise. It is admitted by running it against the BASE commit, before any implementation exists. An agent-authored oracle is allowed, but only in a separate pre-run, and it stays untrusted until approved.",
    ev: ["oracle.constructed", "oracle.admitted"],
    checks: [
      "implementationRunId is null — the oracle predates the implementation",
      "expectedBefore: fail for new behaviour (the test fails on the base commit)",
      "For a bug fix: a regression test that PASSES on the unfixed code is rejected",
      "Authorship is recorded — agent-authored tests are flagged in the GateReport",
    ],
    fails: "Admission fails ⇒ repair once, then ESCALATED.",
    note: "If the same agent writes the fix and the test that judges it, the gate measures the agent agreeing with itself. The defence is provenance, not trust.",
    key: true,
  },
  {
    n: 5, title: "Planning — task graph", zone: "Z1", nodes: ["worker", "orch", "pg"],
    state: "PLANNED", tier: "R2", eff: "E0",
    actor: "Agent", who: "Planner (a component, not a prompt)",
    body: "The plan is a task graph. Topology is chosen per dependency edge: independent work may fan out, dependent work runs sequentially with a FRESH CONTEXT — upstream artefact only, never upstream reasoning. Fan-out is permitted only if all four chunkability conditions hold.",
    ev: ["plan.produced", "plan.validated"],
    checks: ["Every node has an executor and a context scope", "Fan-out only where all four chunkability conditions hold", "The plan is admissible against the applied definition"],
    fails: "Invalid plan ⇒ ESCALATED.",
    note: "The planner is a component, not a prompt. That is what makes the fan-out decision auditable after the fact.",
  },
  {
    n: 6, title: "Plan approval", zone: "Z0", nodes: ["owner", "api", "pg"],
    state: "QUEUED", tier: "R2", eff: "E0",
    actor: "Human", who: "Owner at AP-2",
    body: "The plan and the oracle are approved together, as one artefact. The approval binds (type, artefactKind, artefactRef, artefactSha256) — so a modified artefact voids it, and a new commit resets the check.",
    ev: ["approval.requested", "approval.granted"],
    checks: ["Approval is named and artefact-hash bound", "The approver is a person, not a model", "Approval has not expired"],
    fails: "Refused ⇒ REJECTED.",
    note: "This is the same mechanism that makes a factory change safe — a change to the factory is a change like any other.",
    key: true,
  },
  {
    n: 7, title: "Implement in T2 via harness", zone: "Z3", nodes: ["worker", "t2", "harness", "broker", "cred", "gateway", "gwpassthru", "llm"],
    state: "RUNNING", tier: "R2", eff: "E1",
    actor: "Agent", who: "Implementer, inside a rootless container",
    body: "The worker leases the node, assembles a pinned context, provisions a rootless T2 container (read-only fs, cap-drop ALL, no docker.sock, user 10001), and runs the harness inside it. The harness PROPOSES actions; every one is re-checked by deterministic policy at the broker.",
    ev: ["node.leased", "environment.provisioned", "model.requested", "tool.invoked"],
    checks: [
      "Context is pinned by id and version — resolvedContextSha256 recorded",
      "Context budget not exceeded (over budget is a FAILURE, never a truncation)",
      "Every tool call passed the broker's 10-step pipeline",
      "Credentials are ephemeral and injected at the invocation boundary — never in context",
      "Egress went through the allow-listed proxy on :3128",
    ],
    fails: "Budget exhausted ⇒ INCOMPLETE (partial artefacts preserved). Environment failure ⇒ retry with a fresh environment.",
    note: "The container has no database role, no secret, and no route out except the proxy and the gateway. It cannot reach the control plane, and it does not need to.",
  },
  {
    n: 8, title: "Patch extraction + scope validation + push", zone: "Z2", nodes: ["worker", "broker", "github"],
    state: "RUNNING", tier: "R3", eff: "E2",
    actor: "Deterministic + broker", who: "Worker, on the host — never inside the container",
    body: "The patch is extracted from the container and applied to a CLEAN HOST WORKTREE. Scope validation checks it against the granted path scope. The worker never executes host git inside any container-writable directory.",
    ev: ["patch.extracted", "tool.invoked"],
    checks: ["Patch touches only granted paths", "Patch applies cleanly to the base SHA", "The push token is minted per-task and scoped to one branch"],
    fails: "Scope violation ⇒ patch.rejected, node failed.",
    note: "Data crosses the boundary as untrusted bytes, copied out by the worker. It is never granted a path back into the control plane.",
  },
  {
    n: 9, title: "Verify in a FRESH T2 container", zone: "Z3", nodes: ["worker", "t2", "gates"],
    state: "VERIFYING", tier: "R3", eff: "E0",
    actor: "Deterministic", who: "The verification runtime — no model in the loop",
    body: "Verification runs in a NEW container, not the one that produced the code. The gate order is fixed: static/typecheck/lint → existing tests → acceptance oracle → security scan → gate-weakening detector → GateReport. A verifier that misses a violation cannot gate a merge, so the verifier itself has to be calibrated.",
    ev: ["gate.passed", "gate.failed"],
    checks: [
      "The acceptance oracle passes — and its authorship is recorded",
      "The gate-weakening detector found no deleted test, lowered coverage, or skip marker",
      "The security scan is within its calibrated threshold",
      "The verifier used is itself calibrated on a corpus with violation AND conforming samples",
    ],
    fails: "Fail with iterations left (≤2) ⇒ back to RUNNING. Otherwise ⇒ FAILED.",
    note: "Verification is deterministic. There is no agent judging whether the code is good enough — only gates that either pass or do not.",
    key: true,
  },
  {
    n: 10, title: "Review + panel, open PR", zone: "Z2", nodes: ["worker", "gateway", "github", "artifact"],
    state: "AWAITING_REVIEW", tier: "R3", eff: "E2",
    actor: "Agent + deterministic", who: "Reviewer agent and a fixed panel",
    body: "A reviewer agent examines the change, and a panel of fixed checks runs alongside it. The reviewer sees the evidence bundle but NOT the implementer's transcript — so it cannot be anchored by the reasoning that produced the code.",
    ev: ["review.queued", "change.opened"],
    checks: ["Reviewer did not see the implementer transcript", "Panel verdicts recorded separately from the reviewer verdict", "PR opened with the merge gate bound to the head SHA"],
    fails: "Blockers ⇒ one rework loop, then flagged to the owner.",
  },
  {
    n: 11, title: "Owner reviews, approves, merges", zone: "Z0", nodes: ["owner", "gh-ui", "github", "api"],
    state: "APPROVED → MERGING → MERGED", tier: "R3", eff: "E2",
    actor: "Human", who: "The owner — and at L2, this is mandatory",
    body: "A human reads the code. At L2 this is the FLOOR, not a courtesy. The policy engine enforces it at the APPROVED → MERGING guard: the transition is refused unless the applicable approval class is satisfied. The required merge-gate check is bound to the head SHA, so a new commit resets it and voids prior approvals.",
    ev: ["review.approved", "approval.granted", "change.merged"],
    checks: ["The merge gate passed against THIS head SHA", "The applicable approval class is satisfied", "Autonomy level permits, or a human initiated the merge"],
    fails: "Refused ⇒ REJECTED.",
    note: "The blueprint deliberately gives up the corpus's headline throughput claims to keep a defensible quality position. That is why the default is L2, not L3.",
    key: true,
  },
  {
    n: 12, title: "Record knowledge, reclaim environment", zone: "Z1", nodes: ["worker", "artifact", "pg", "objstore"],
    state: "terminal", tier: "R1", eff: "E0",
    actor: "Deterministic", who: "The worker, finally",
    body: "The 12-element run record is written: task identity, effective context hash, model/harness/config versions, every tool call, prompts, per-layer verification results, hashed artefacts, outcome, approval, authority, tokens, cost. The environment is torn down and the credential revoked.",
    ev: ["environment.cleaned", "credential.revoked"],
    checks: ["All 12 artefact elements present", "Credential revoked — it cannot outlive its task", "Cost attributed to the accepted change"],
    fails: "Cleanup failure ⇒ the reaper retries, and an alert fires.",
    note: "This is what gives the improvement loop a substrate. Without the artefact store, self-improvement is guesswork.",
  },
];

export function renderSimulation() {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Simulation",
    "One task, from issue to merged pull request",
    "This is the spine of the factory — Workflow B — running as an animation. Watch the task move between trust zones. Notice which stages happen inside the untrusted data plane, which happen on the host, and which require a human. The dashed red path is the one that never exists."
  ));

  let stage = 0;
  let playing = false;
  let timer = null;

  const stageEl = h("div", { class: "sim-stage" });
  const sideEl = h("div", { class: "sim-side" });

  /* ---- the map (reused geometry from the architecture map) ---- */
  const svg = svgEl("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "xMidYMid meet", style: "width:100%;height:auto;display:block" });
  const gBands = svgEl("g"), gTrail = svgEl("g"), gTrailAnim = svgEl("g"), gNodes = svgEl("g"), gPulses = svgEl("g");
  svg.append(gBands, gTrail, gTrailAnim, gNodes, gPulses);

  /* zone bands */
  const byZone = {};
  NODES.forEach((n) => { (byZone[n.zone] = byZone[n.zone] || []).push(n); });
  for (const z of ZONES) {
    const ns = byZone[z.id];
    if (!ns) continue;
    const x0 = Math.min(...ns.map((n) => n.x)) - 2.4;
    const y0 = Math.min(...ns.map((n) => n.y)) - 3.4;
    const x1 = Math.max(...ns.map((n) => n.x + n.w)) + 2.4;
    const y1 = Math.max(...ns.map((n) => n.y + n.h)) + 3.6;
    gBands.append(svgEl("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 1.2, fill: "rgba(255,255,255,.014)", stroke: z.color, "stroke-opacity": ".2", "stroke-width": ".16" }));
    const t = svgEl("text", { x: x0 + 1, y: y0 + 2.1, fill: z.color, "font-size": "2", "font-weight": "700", "letter-spacing": ".09em" });
    t.textContent = `${z.id} · ${z.name}`;
    gBands.append(t);
  }

  /* nodes */
  const nodeEls = {};
  NODES.forEach((n) => {
    const z = ZONES.find((zz) => zz.id === n.zone);
    const g = svgEl("g", { class: "sim-node" });
    g.append(svgEl("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: .7, fill: "rgba(24,34,56,.9)", stroke: z ? z.color : "#4a6588", "stroke-opacity": ".32", "stroke-width": ".2" }));
    const t = svgEl("text", { x: n.x + n.w / 2, y: n.y + n.h / 2 + .6, "text-anchor": "middle", fill: "#a9b7d0", "font-size": "1.5", "font-weight": "600" });
    t.textContent = n.label;
    g.append(t);
    gNodes.append(g);
    nodeEls[n.id] = { g, n };
  });

  /* edges (thin, for context) */
  const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const edgePath = (a, b) => {
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
    const sx = ax + (dx / d) * 1.1, sy = ay + (dy / d) * 1.1, ex = bx - (dx / d) * 1.1, ey = by - (dy / d) * 1.1;
    const mx = (sx + ex) / 2, my = (sy + ey) / 2, off = 3.2;
    return { d: `M ${sx} ${sy} Q ${mx - (dy / d) * off} ${my + (dx / d) * off} ${ex} ${ey}`, sx, sy, ex, ey };
  };
  EDGES.forEach((e) => {
    const a = nodeById[e.from], b = nodeById[e.to];
    if (!a || !b) return;
    const p = edgePath(a, b);
    gTrail.append(svgEl("path", { d: p.d, fill: "none", stroke: "#3d5379", "stroke-width": ".18", opacity: ".45" }));
  });

  /* trail: the path the task takes, drawn stage by stage */
  let trailPath = "";
  const stageAnchor = (s) => {
    const ns = s.nodes.map((id) => nodeById[id]).filter(Boolean);
    if (!ns.length) return { x: 50, y: 50 };
    const cx = ns.reduce((a, n) => a + n.x + n.w / 2, 0) / ns.length;
    const cy = ns.reduce((a, n) => a + n.y + n.h / 2, 0) / ns.length;
    return { x: cx, y: cy };
  };

  const mapCard = card({ cls: "pad-sm" });
  mapCard.append(svg);
  const legend = h("div", { class: "sm-legend" });
  legend.append(
    h("div", { class: "li" }, h("span", { class: "sw", style: { borderColor: "var(--accent)" } }), "components in this stage"),
    h("div", { class: "li" }, h("span", { class: "sw", style: { borderColor: "var(--accent-2)", background: "rgba(167,139,250,.2)" } }), "the task's path so far"),
  );
  mapCard.append(legend);

  /* ---- stage panel ---- */
  function renderStage() {
    const s = STAGES[stage];
    const z = ZONES.find((zz) => zz.id === s.zone);
    const tier = TIERS.find((t) => t.id === s.tier);
    const eff = EFFECT_CLASSES.find((e) => e.id === s.eff);

    /* map focus */
    const active = new Set(s.nodes);
    Object.entries(nodeEls).forEach(([id, el]) => {
      const on = active.has(id);
      el.g.style.opacity = on ? "1" : ".22";
      const rect = el.g.firstChild;
      rect.setAttribute("fill", on ? "rgba(45,63,102,.98)" : "rgba(24,34,56,.9)");
      rect.setAttribute("stroke-width", on ? ".5" : ".2");
      rect.setAttribute("stroke-opacity", on ? ".95" : ".32");
    });

    /* trail */
    const anchor = stageAnchor(s);
    if (stage > 0) {
      const prev = stageAnchor(STAGES[stage - 1]);
      const p = edgePath({ x: prev.x - 4, y: prev.y - 3, w: 8, h: 6 }, { x: anchor.x - 4, y: anchor.y - 3, w: 8, h: 6 });
      gTrailAnim.append(svgEl("path", { d: p.d, fill: "none", stroke: "#a78bfa", "stroke-width": ".5", opacity: ".9" }));
      const pulse = svgEl("circle", { r: ".9", fill: "#7dd3fc" });
      pulse.append(svgEl("animate", { attributeName: "cx", from: p.sx, to: p.ex, dur: "1.1s", fill: "freeze" }));
      pulse.append(svgEl("animate", { attributeName: "cy", from: p.sy, to: p.ey, dur: "1.1s", fill: "freeze" }));
      pulse.append(svgEl("animate", { attributeName: "opacity", values: "0;1;0", dur: "1.1s", fill: "freeze" }));
      gPulses.append(pulse);
      setTimeout(() => { if (gPulses.lastChild === pulse) gPulses.removeChild(pulse); }, 1400);
    }

    /* side panel */
    sideEl.innerHTML = "";
    const sc = card({ title: `Stage ${s.n} of ${STAGES.length}`, sub: s.state });
    sc.append(
      h("div", { class: "insp-zone", style: { color: z ? z.color : "" } },
        h("span", { class: "sw", style: { background: z ? z.color : "#888" } }),
        `${s.zone} · ${z ? z.name : ""}`),
      h("div", { class: "insp-title", style: { fontSize: "16px" }, text: s.title }),
      h("div", { class: "insp-sub", text: s.who }),
      h("div", { class: "insp-body", text: s.body }),
    );
    if (s.note) sc.append(h("div", { style: { marginTop: "11px" } }, callout(s.note, s.key ? "" : "warn")));
    sideEl.append(sc);

    /* checks card */
    const cc = card({ title: "What must be true", sub: `${s.checks.length} checks` });
    cc.append(h("ul", { class: "list check" }, ...s.checks.map((c) =>
      h("li", {}, h("span", { class: "dot" }), h("span", { text: c })))));
    cc.append(h("div", { style: { marginTop: "12px" } },
      callout("<b>On failure:</b> " + s.fails, "bad")));
    sideEl.append(h("div", { style: { marginTop: "16px" } }, cc));

    /* events card */
    const ec = card({ title: "Events emitted", sub: "appended to the event log" });
    ec.append(h("div", { class: "tags" }, ...s.ev.map((e) => h("span", { class: "tag a", text: e }))));
    ec.append(h("div", { style: { marginTop: "12px" } }, kv([
      ["Task state", s.state],
      ["Risk tier", `${s.tier} — ${tier ? tier.name : ""}`],
      ["Effect class", `${s.eff} — ${eff ? eff.name : ""}`],
      ["Actor", s.actor],
    ])));
    sideEl.append(h("div", { style: { marginTop: "16px" } }, ec));
  }

  /* ---- pipeline strip ---- */
  const strip = h("div", { class: "pipeline" });
  function renderStrip() {
    strip.innerHTML = "";
    STAGES.forEach((s, i) => {
      const z = ZONES.find((zz) => zz.id === s.zone);
      const cls = "pipe-step" + (i < stage ? " done" : "") + (i === stage ? " now" : "") + (s.key ? " key" : "");
      strip.append(h("div", { class: cls },
        h("div", { class: "pipe-rail" },
          h("div", { class: "pipe-dot", style: i === stage ? { borderColor: z ? z.color : "", color: z ? z.color : "" } : {}, text: String(s.n) })),
        h("div", { class: "pipe-body", style: { cursor: "pointer" }, onclick: () => { stage = i; stop(); renderStage(); renderStrip(); updateCtl(); } },
          h("div", { class: "pipe-title", text: s.title }),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" } },
            h("span", { class: "tag", style: { color: z ? z.color : "", borderColor: z ? z.color + "66" : "" }, text: s.zone }),
            h("span", { class: "tag", text: s.state }),
            h("span", { class: "tag", text: s.tier })),
        ),
      ));
    });
  }

  /* ---- controls ---- */
  const ctl = h("div", { class: "sim-controls" });
  const btnPrev = h("button", { class: "btn", type: "button", onclick: () => { stage = Math.max(0, stage - 1); stop(); renderStage(); renderStrip(); updateCtl(); } }, "← Back");
  const btnNext = h("button", { class: "btn primary", type: "button", onclick: () => { stage = Math.min(STAGES.length - 1, stage + 1); stop(); renderStage(); renderStrip(); updateCtl(); } }, "Next stage →");
  const btnPlay = h("button", { class: "btn", type: "button", onclick: () => { playing ? stop() : play(); } }, "▶ Auto-run");
  const progWrap = h("div", { class: "progress-wrap" });
  const progFill = h("div", { class: "progress-fill", style: { width: "0%" } });
  progWrap.append(h("div", { class: "progress-bar" }, progFill));
  const progTxt = h("div", { class: "progress-txt", text: "" });
  progWrap.append(progTxt);

  function updateCtl() {
    progFill.style.width = (stage / (STAGES.length - 1)) * 100 + "%";
    progTxt.textContent = `stage ${stage + 1} / ${STAGES.length} — ${STAGES[stage].title}`;
    btnPrev.disabled = stage === 0;
    btnNext.disabled = stage === STAGES.length - 1;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Auto-run";
  }

  ctl.append(btnPrev, btnNext, btnPlay, progWrap);

  function play() {
    playing = true;
    timer = setInterval(() => {
      if (stage >= STAGES.length - 1) { stop(); return; }
      stage++; renderStage(); renderStrip(); updateCtl();
    }, 3200);
    updateCtl();
  }
  function stop() { playing = false; clearInterval(timer); timer = null; updateCtl(); }

  /* ---- assemble ---- */
  const grid = h("div", { class: "grid", style: { gridTemplateColumns: "minmax(0,1fr) 400px", gap: "18px", alignItems: "start" } });
  const left = h("div", {});
  left.append(mapCard, h("div", { style: { marginTop: "16px" } }, ctl));
  grid.append(left, sideEl);
  page.append(h("div", { class: "fade-in" }, grid));

  page.append(h("div", { class: "fade-in", style: { marginTop: "22px" } },
    card({ title: "The whole spine, stage by stage", sub: "click any stage to jump to it" }, strip)));

  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } },
    card({ title: "Where the work happens", sub: "trust zones per stage" },
      table(["Stage", "Zone", "Actor"], STAGES.map((s) => ({
        cells: [
          h("b", { text: `${s.n}. ${s.title}` }),
          h("span", { class: "tag", style: { color: (ZONES.find((z) => z.id === s.zone) || {}).color, borderColor: ((ZONES.find((z) => z.id === s.zone) || {}).color || "") + "55" }, text: s.zone }),
          s.actor,
        ],
      })))),
    card({ title: "The four load-bearing stages", sub: "the ones that make the factory safe" },
      h("ul", { class: "list" }, ...STAGES.filter((s) => s.key).map((s) =>
        h("li", {}, h("span", { class: "dot" }), h("span", { html: `<b>${s.n}. ${esc(s.title)}</b><br><span style="font-size:12.6px">${esc(s.note || "")}</span>` })))),
      h("div", { style: { marginTop: "12px" } },
        callout("<b>Why these four.</b> Oracle construction (4) means the judge is independent of the judged. Plan approval (6) means a human authorised the work. Verification in a fresh container (9) means the code cannot vouch for itself. The human merge (11) means somebody read it. Remove any one of them and the safety story becomes a claim rather than a structure.")))
  ));

  renderStage(); renderStrip(); updateCtl();
  return page;
}
