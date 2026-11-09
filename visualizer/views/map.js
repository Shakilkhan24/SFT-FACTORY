/* ============================================================
   VIEW — Animated architecture map
   ============================================================ */

import { h, svgEl, esc } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, drawerRecord, tag, tags, callout } from "./ui.js";

const { ZONES, NODES, EDGES, BLOCKED_PATHS, BOUNDARY_RULES } = DATA;

/* zone band rectangles — computed from node positions so the bands always fit */
function zoneBounds() {
  const out = {};
  for (const z of ZONES) {
    const ns = NODES.filter((n) => n.zone === z.id);
    if (!ns.length) continue;
    const x0 = Math.min(...ns.map((n) => n.x)) - 2.4;
    const y0 = Math.min(...ns.map((n) => n.y)) - 3.4;
    const x1 = Math.max(...ns.map((n) => n.x + n.w)) + 2.4;
    const y1 = Math.max(...ns.map((n) => n.y + n.h)) + 3.6;
    out[z.id] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, nodes: ns };
  }
  return out;
}

export function renderMap(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The architecture",
    "Where everything lives, and what cannot happen",
    "Every box is a real component of the blueprint. Every line is a real path. The severed red lines are the point of the whole design: in a software factory, the interesting behaviour is the paths that do NOT exist."
  ));

  const shell = h("div", { class: "map-shell fade-in" });
  const stage = h("div", { class: "map-stage" });
  const inspector = h("div", { class: "inspector" });

  /* ---- toolbar ---- */
  const toolbar = h("div", { class: "map-toolbar" });
  const svg = svgEl("svg", { id: "map-svg", viewBox: "0 0 100 100", preserveAspectRatio: "xMidYMid meet" });

  const state = {
    selected: params.focus || null,
    zoneFilter: params.focusZone || null,
    showBlocked: true,
    showFlow: true,
  };

  /* ---------- build SVG ---------- */

  const gZones = svgEl("g", { class: "zone-band" });
  const gEdges = svgEl("g", { class: "edges" });
  const gFlow = svgEl("g", { class: "flow" });
  const gBlocked = svgEl("g", { class: "blocked" });
  const gNodes = svgEl("g", { class: "nodes" });

  svg.append(gZones, gEdges, gFlow, gBlocked, gNodes);

  const bounds = zoneBounds();

  /* zone bands */
  for (const z of ZONES) {
    const b = bounds[z.id];
    if (!b) continue;
    const grp = svgEl("g", { class: "zone-group", "data-zone": z.id });
    grp.append(svgEl("rect", {
      class: "zone-rect", x: b.x, y: b.y, width: b.w, height: b.h,
      stroke: z.color, "stroke-opacity": ".22",
    }));
    grp.append(svgEl("text", { class: "zone-label", x: b.x + 1, y: b.y + 2.1, fill: z.color }));
    grp.lastChild.textContent = `${z.id} · ${z.name}`;
    grp.append(svgEl("text", { class: "zone-trust", x: b.x + 1, y: b.y + 3.7 }));
    grp.lastChild.textContent = z.subtitle;
    gZones.append(grp);
  }

  /* edges */
  const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));

  function edgePath(a, b) {
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2, by = b.y + b.h / 2;
    const dx = bx - ax, dy = by - ay;
    const dist = Math.hypot(dx, dy) || 1;
    const pad = 1.1;
    const sx = ax + (dx / dist) * pad, sy = ay + (dy / dist) * pad;
    const ex = bx - (dx / dist) * pad, ey = by - (dy / dist) * pad;
    const mx = (sx + ex) / 2, my = (sy + ey) / 2;
    const off = 3.2;
    const cx = mx - (dy / dist) * off, cy = my + (dx / dist) * off;
    return { d: `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`, sx, sy, ex, ey, cx, cy, mx, my };
  }

  const edgeEls = [];
  for (const e of EDGES) {
    const a = nodeById[e.from], b = nodeById[e.to];
    if (!a || !b) continue;
    const p = edgePath(a, b);
    const base = svgEl("path", { class: "edge " + e.kind, d: p.d });
    const flow = svgEl("path", { class: "flowline", d: p.d, stroke: e.kind === "policy" ? "#a78bfa" : "#5fd0ff" });
    flow.style.animationDuration = (1.3 + Math.random() * 1.1).toFixed(2) + "s";
    gEdges.append(base);
    gFlow.append(flow);
    const lbl = e.label
      ? svgEl("text", { class: "edge-label", x: p.cx, y: p.cy, "text-anchor": "middle" })
      : null;
    if (lbl) { lbl.textContent = e.label; lbl.setAttribute("fill", "#6f7f9d"); lbl.setAttribute("font-size", "1.12"); gEdges.append(lbl); }
    edgeEls.push({ e, base, flow, lbl, a: e.from, b: e.to });
  }

  /* blocked paths — rendered as severed routes with an X */
  const blockedEls = [];
  BLOCKED_PATHS.forEach((bp, i) => {
    const grp = svgEl("g", { class: "blocked-group" });
    let x1, y1, x2, y2;
    if (bp.from === "Z3" && bp.to === "Z1") { x1 = 33; y1 = 87; x2 = 33; y2 = 34; }
    else if (bp.from === "Z3" && bp.to === "host") { x1 = 27.5; y1 = 87; x2 = 18; y2 = 92; }
    else if (bp.from === "Z3" && bp.to === "Z4") { x1 = 42; y1 = 90; x2 = 82; y2 = 87; }
    else if (bp.from === "Z1" && bp.to === "Z1") { x1 = 68.5; y1 = 45.5; x2 = 68.5; y2 = 36; }
    else { x1 = 30; y1 = 86; x2 = 70; y2 = 60; }

    grp.append(svgEl("path", { class: "blocked-line", d: `M ${x1} ${y1} L ${x2} ${y2}` }));
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    grp.append(svgEl("path", { class: "blocked-x", d: `M ${mx - 1.1} ${my - 1.1} L ${mx + 1.1} ${my + 1.1}` }));
    grp.append(svgEl("path", { class: "blocked-x", d: `M ${mx - 1.1} ${my + 1.1} L ${mx + 1.1} ${my - 1.1}` }));
    const lb = svgEl("text", { class: "blocked-label", x: mx, y: my + 2.4, "text-anchor": "middle" });
    lb.textContent = bp.what;
    grp.append(lb);
    grp.addEventListener("click", () => openBlocked(bp));
    grp.style.cursor = "pointer";
    gBlocked.append(grp);
    blockedEls.push({ bp, grp });
  });

  /* nodes */
  const nodeEls = {};
  for (const n of NODES) {
    const grp = svgEl("g", { class: "node" + (n.emphasis ? " emph" : ""), "data-id": n.id });
    const z = ZONES.find((zz) => zz.id === n.zone);
    grp.append(svgEl("rect", { class: "node-box", x: n.x, y: n.y, width: n.w, height: n.h, stroke: z ? z.color : "#4a6588", "stroke-opacity": n.emphasis ? ".75" : ".35" }));
    const t = svgEl("text", { class: "node-label", x: n.x + n.w / 2, y: n.y + n.h / 2 - (n.sub ? 0.35 : 0), "text-anchor": "middle" });
    t.textContent = n.label;
    grp.append(t);
    if (n.sub) {
      const s = svgEl("text", { class: "node-sub", x: n.x + n.w / 2, y: n.y + n.h / 2 + 1.75, "text-anchor": "middle" });
      s.textContent = n.sub;
      grp.append(s);
    }
    grp.addEventListener("click", () => selectNode(n.id));
    grp.addEventListener("mouseenter", () => hoverNode(n.id));
    grp.addEventListener("mouseleave", () => hoverNode(null));
    gNodes.append(grp);
    nodeEls[n.id] = grp;
  }

  stage.append(toolbar, svg);

  /* ---------- toolbar controls ---------- */

  function mkChip(label, active, onclick, swatch) {
    return h("button", { class: "chip" + (active ? " on" : ""), type: "button", onclick },
      swatch ? h("span", { class: "sw", style: { background: swatch } }) : null, label);
  }

  toolbar.append(
    h("span", { class: "kicker", text: "Zones" }),
    ...ZONES.map((z) => mkChip(z.id, state.zoneFilter === z.id, () => {
      state.zoneFilter = state.zoneFilter === z.id ? null : z.id;
      render();
    }, z.color)),
    h("span", { class: "sp" }),
    mkChip("Blocked paths", state.showBlocked, () => { state.showBlocked = !state.showBlocked; gBlocked.style.display = state.showBlocked ? "" : "none"; }),
    mkChip("Flow animation", state.showFlow, () => {
      state.showFlow = !state.showFlow;
      gFlow.style.display = state.showFlow ? "" : "none";
    }),
    mkChip("Reset", false, () => { state.zoneFilter = null; state.selected = null; render(); }),
  );

  /* ---------- selection & dimming ---------- */

  function neighbours(id) {
    const s = new Set();
    edgeEls.forEach((x) => { if (x.a === id) s.add(x.b); if (x.b === id) s.add(x.a); });
    return s;
  }

  function applyFocus() {
    const sel = state.selected;
    const nb = sel ? neighbours(sel) : null;

    for (const n of NODES) {
      const grp = nodeEls[n.id];
      let dim = false;
      if (state.zoneFilter) dim = n.zone !== state.zoneFilter;
      if (sel) {
        if (n.id !== sel && !nb.has(n.id)) dim = true;
      }
      grp.style.opacity = dim ? ".18" : "1";
      grp.classList.toggle("sel", n.id === sel);
    }
    edgeEls.forEach((x) => {
      const related = !sel || x.a === sel || x.b === sel;
      x.base.classList.toggle("dim", !related || !!state.zoneFilter);
      x.flow.classList.toggle("dim", !related || !!state.zoneFilter);
      if (x.lbl) x.lbl.style.opacity = related ? "1" : ".15";
    });
    blockedEls.forEach((x) => {
      x.grp.style.opacity = state.zoneFilter ? ".2" : ".85";
    });
  }

  function render() {
    applyFocus();
    renderInspector();
    // refresh toolbar chip states
    toolbar.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
    const chips = toolbar.querySelectorAll(".chip");
    let ci = 0;
    ZONES.forEach((z) => { if (state.zoneFilter === z.id) chips[ci].classList.add("on"); ci++; });
    if (state.showBlocked) chips[ci].classList.add("on"); ci++;
    if (state.showFlow) chips[ci].classList.add("on");
  }

  /* ---------- inspector ---------- */

  const NODE_DETAIL = {
    api: ["apps/api", "The only way in. Typed REST endpoints for the six access points, GitHub webhooks in, SSE out to the dashboard. Holds no authoritative state of its own — it writes through the control plane."],
    worker: ["apps/worker", "The orchestrator process. Claims leased nodes, assembles context, provisions environments, drives the harness, and extracts patches. It can instruct the data plane; it cannot authorise it."],
    policy: ["PolicyEngine", "Pure, deterministic, fail-closed. Nine steps. It is the only component that can say yes to a consequential action, and no model is ever consulted. ADR-0004 splits policy authority from orchestration authority so no single component holds both."],
    eventlog: ["EventLog", "Append-only, hash-chained. Every state transition and every broker decision appends here, in the same transaction as the state change. This is what makes a run reconstructable."],
    state: ["StateMachine", "19 task states, 8 node states, 34 guarded transitions. A transition is legal only if its guard passes — and the transition and its event are written together, so the log can never disagree with the state."],
    scheduler: ["Scheduler", "Relational-backed job queue with leases. Uses SKIP LOCKED so two workers never claim the same node. Capacity comes from the definition, never from auto-fill."],
    orch: ["Orchestrator", "Decides HOW a stage runs. Cannot widen scope, escalate autonomy, mint credentials, or bypass a gate. When it is unsure, the arbitration rule is deny-by-default and escalate."],
    pg: ["Postgres", "Authoritative state, the append-only event log, and the projections. One relational store means exactly-once transitions and audit become properties of the database rather than of application code."],
    objstore: ["Object store", "Run artefacts: patches, logs, oracle outputs, prompts, generated text, verification reports. The artefact store is a hard prerequisite of the improvement loop — without it, self-improvement has no substrate."],
    secret: ["Secret store", "sops+age on the host. The control plane reads secrets; the data plane never does. No secret is ever mounted into a container."],
    defn: ["Definition store", "Declarative, version-controlled, applied by SHA. The applier is the ONLY role with INSERT on definition_versions. A control-surface write is rejected — privilege escalation cannot happen silently."],
    context: ["ContextAssembler", "Selects, pins and budgets context. Deterministically. Over budget is a failure, never a truncation — silently dropping context is how a factory produces confidently wrong output."],
    artifact: ["ArtefactStore", "The 12-element run record. Task identity, effective context hash, model/harness/config versions, every tool call, prompts, per-layer verification results, hashed artefacts, outcome, approval, authority, tokens, cost."],
    broker: ["ToolBroker", "The 10-step choke point. Every effect on an external system passes through here: evaluate policy, check grants, mint an ephemeral credential, invoke, redact, log. There is no second path."],
    cred: ["CredentialBroker", "Mints ephemeral, per-task credentials injected at the invocation boundary. Never present in context, never stored in a prompt, revocable the moment the task ends. Agents never hold or request credentials."],
    gateway: ["ModelGateway", "Routing, budgets, failover. A single provider dependency would violate I-9, so the gateway abstracts over providers and a failover test proves it."],
    egress: ["factory-egress", "The only route out of the sandbox. A token-bound CONNECT proxy on :3128 with a host allow-list, default-deny. DNS is resolved inside the proxy and checked against private ranges. The proxy being down means no network at all."],
    gwpassthru: ["factory-gateway", "Model passthrough for the container. The harness talks to this, never directly to the provider. Task-scoped token, model allow-list."],
    t2: ["T2 container", "Rootless Docker. Read-only filesystem, cap-drop ALL, no-new-privileges, pids/memory/cpu caps, user 10001:10001, no docker.sock mounted. Mandatory for any stage that executes repo code."],
    harness: ["Claude Code harness", "The agent runtime inside T2. The harness proposes; it never authorises. Its internal tools are governed by isolation rather than by policy, because there is no broker in the path."],
    gates: ["Verification gates", "static/typecheck/lint → existing tests → acceptance oracle → security scan → gate-weakening detector → GateReport. The oracle is the primary gate, and it was written before the implementation."],
    github: ["GitHub", "The App, pull requests, check runs, branch rulesets and CODEOWNERS. The merge-gate required check is bound to the head SHA, so a new commit resets it and voids prior approvals."],
    llm: ["Model providers", "Anthropic primary, an OpenAI-compatible secondary. The gateway handles routing, budgets and failover. A fake provider backs every test."],
    registry: ["Package registries", "npm, PyPI, crates — reachable only through the allow-listed egress proxy."],
    owner: ["Owner", "The only source of intent and judgement. Dashboard, CLI, GitHub UI. Six typed access points; there is no informal 'chat with the agent' path."],
    "gh-ui": ["GitHub UI", "Where review and merge happen. At L2, a human reading the code is the floor, not a courtesy."],
  };

  function renderInspector() {
    inspector.innerHTML = "";
    const id = state.selected;
    if (!id) {
      inspector.append(
        h("div", { class: "insp-empty" },
          h("div", { class: "big", text: "◈" }),
          h("div", { text: "Click any component to see what it is, what it is allowed to do, and what it is forbidden from doing." }),
          h("div", { style: { marginTop: "14px" } }, callout("<b>The severed red lines</b> are blocked paths. Click one to read why it cannot exist.")),
        )
      );
      return;
    }
    const n = NODES.find((x) => x.id === id);
    if (!n) return;
    const z = ZONES.find((zz) => zz.id === n.zone);
    const d = NODE_DETAIL[n.id];
    const ins = h("div", {});
    ins.append(
      h("div", { class: "insp-zone", style: { color: z ? z.color : "" } },
        h("span", { class: "sw", style: { background: z ? z.color : "#888" } }),
        `${n.zone} · ${z ? z.name : ""}`,
      ),
      h("div", { class: "insp-title", text: d ? d[0] : n.label }),
      h("div", { class: "insp-sub", text: n.sub }),
    );
    if (d) ins.append(h("div", { class: "insp-body", text: d[1] }));

    /* zone summary */
    if (z) {
      const sec = h("div", { class: "insp-sec" });
      sec.append(h("h5", { text: `Zone ${z.id} — ${z.name}` }));
      sec.append(h("p", { style: { fontSize: "12.9px", color: "var(--ink-2)", marginBottom: "8px" }, text: z.summary }));
      const ul = h("ul", {});
      z.contains.forEach((c) => ul.append(h("li", { text: c })));
      sec.append(ul);
      sec.append(h("div", { class: "tags", style: { marginTop: "8px" } },
        tag(`trust: ${z.trust}`, z.trust === "trusted" ? "g" : z.trust === "untrusted" ? "b" : "w")));
      ins.append(sec);
    }

    /* connections */
    const conn = h("div", { class: "insp-sec" });
    conn.append(h("h5", { text: "Connections" }));
    const ul = h("ul", {});
    edgeEls.forEach((x) => {
      if (x.a === id) ul.append(h("li", { html: `<b>→ ${nodeById[x.b].label}</b>${x.e.label ? " · " + esc(x.e.label) : ""} <span style="color:var(--ink-3)">[${x.e.kind}]</span>` }));
      if (x.b === id) ul.append(h("li", { html: `<b>← ${nodeById[x.a].label}</b>${x.e.label ? " · " + esc(x.e.label) : ""} <span style="color:var(--ink-3)">[${x.e.kind}]</span>` }));
    });
    conn.append(ul);
    ins.append(conn);

    /* boundary rules mentioning this component */
    const rules = BOUNDARY_RULES.filter((r) => r.text.toLowerCase().includes((n.label.split(" ")[0] || "").toLowerCase()));
    if (rules.length) {
      const sec = h("div", { class: "insp-sec" });
      sec.append(h("h5", { text: "Boundary rules" }));
      rules.forEach((r) => sec.append(h("p", { style: { fontSize: "12.7px", marginBottom: "7px" }, text: r.id + " — " + r.text })));
      ins.append(sec);
    }

    inspector.append(ins);
  }

  function selectNode(id) {
    state.selected = state.selected === id ? null : id;
    applyFocus();
    renderInspector();
  }

  function hoverNode(id) {
    if (state.selected) return;
    applyFocus();
  }

  function openBlocked(bp) {
    drawerRecord("Blocked path", bp.what, [
      { p: bp.why },
      { kv: [["From", bp.from], ["To", bp.to]] },
      { h: "Why this matters", p: "The factory's safety property is topological, not aspirational. There is no runtime check being bypassed here — the route simply does not exist. That is a stronger guarantee than any policy could give." },
    ]);
  }

  shell.append(stage, inspector);
  page.append(shell);

  /* legend + boundary rules below */
  const legend = card({ title: "Reading the map", sub: "line kinds" });
  const lg = h("div", { class: "grid g3" });
  lg.append(
    h("div", {}, h("div", { class: "kicker", text: "Flow" }), h("div", { style: { fontSize: "12.8px", color: "var(--ink-2)" }, text: "A control or request path. The animated dash shows direction of travel." })),
    h("div", {}, h("div", { class: "kicker", text: "Data" }), h("div", { style: { fontSize: "12.8px", color: "var(--ink-2)" }, text: "State or artefact movement. Dashed and un-animated — data does not 'flow', it is written." })),
    h("div", {}, h("div", { class: "kicker", text: "Policy" }), h("div", { style: { fontSize: "12.8px", color: "var(--ink-2)" }, text: "An authorisation decision. The purple path is the only place a 'yes' can come from." })),
  );
  legend.append(lg);
  legend.append(h("hr", { class: "hr" }));
  legend.append(h("div", { class: "kicker", style: { marginBottom: "10px" }, text: "Boundary rules" }));
  legend.append(h("ul", { class: "list" }, ...BOUNDARY_RULES.map((r) =>
    h("li", {}, h("span", { class: "dot" }), h("span", { html: `<b>${r.id}</b> — ${esc(r.text)}` })))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, legend));

  requestAnimationFrame(() => { applyFocus(); renderInspector(); });
  if (params.focus) selectNode(params.focus);

  return page;
}
