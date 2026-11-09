/* ============================================================
   VIEW — Workflow simulator + state machine + agents
   ============================================================ */

import { h, svgEl, esc } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, tag, callout, table, drawerRecord, kv } from "./ui.js";

const { WORKFLOWS, TASK_STATES, TASK_TRANSITIONS, NODE_STATES, NODE_TRANSITIONS, FAILURE_CLASSES, AGENTS, EXCLUDED_ROLES, G_CHAIN } = DATA;

/* ============================================================
   WORKFLOW SIMULATOR
   ============================================================ */

export function renderWorkflows(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Simulation",
    "Walk a task through the factory",
    "Every workflow is a sequence of stages. Each stage names who executes it, what state it leaves the task in, what events it emits, and what happens when it fails. Step through them and watch the shape of the pipeline."
  ));

  const wfId = params.focus && WORKFLOWS.some((w) => w.id === params.focus) ? params.focus : "B";
  let cur = 0, timer = null, playing = false;

  const picker = h("div", { class: "wf-picker" });
  const stage = h("div", { class: "sim-stage" });
  const side = h("div", { class: "sim-side" });

  const wf = () => WORKFLOWS.find((w) => w.id === wfId);

  function buildPicker() {
    picker.innerHTML = "";
    WORKFLOWS.forEach((w) => {
      const b = h("button", { class: "wf-btn" + (w.id === wfId ? " on" : ""), type: "button", onclick: () => {
        wfId = w.id; cur = 0; stop(); buildPicker(); render();
      } },
        h("div", { class: "wf-id", text: w.id }),
        h("div", { class: "wf-name", text: w.name }),
        h("div", { class: "wf-st" },
          tag(w.status, w.statusKind === "in" ? "g" : w.statusKind === "later" ? "w" : "a")),
      );
      picker.append(b);
    });
  }

  function stepEl(s, i, active) {
    const cls = "pipe-step" + (i < cur ? " done" : "") + (i === cur ? " now" : "") + (s.key ? " key" : "");
    const body = h("div", { class: "pipe-body" });
    body.append(h("div", { class: "pipe-title", text: s.title }));
    body.append(h("div", {}, h("span", { class: "pipe-exec", text: s.exec })));

    const meta = h("div", { class: "pipe-meta" });
    if (s.state) meta.append(h("div", { class: "row" }, h("span", { class: "lbl", text: "State" }), h("span", { class: "val", text: s.state })));
    if (s.ev && s.ev.length) {
      const ev = h("div", { class: "val" });
      s.ev.forEach((e) => ev.append(h("span", { class: "chip", text: e })));
      meta.append(h("div", { class: "row" }, h("span", { class: "lbl", text: "Events" }), ev));
    }
    if (s.fail) meta.append(h("div", { class: "row" }, h("span", { class: "lbl", text: "On failure" }), h("span", { class: "val pipe-fail", text: s.fail })));
    body.append(meta);
    if (s.note) body.append(h("div", { class: "pipe-note", text: s.note }));
    if (s.key) body.append(h("div", { style: { marginTop: "9px" } }, tag("load-bearing step", "h")));

    return h("div", { class: cls },
      h("div", { class: "pipe-rail" }, h("div", { class: "pipe-dot", text: String(s.n) })),
      body,
    );
  }

  function render() {
    const w = wf();
    stage.innerHTML = "";

    const head = card({ cls: "pad-sm" });
    head.append(
      h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" } },
        tag(`Workflow ${w.id}`, "a"),
        tag(w.status, w.statusKind === "in" ? "g" : "w"),
        w.spine ? tag("the spine of the factory", "v") : null,
      ),
      h("div", { style: { fontSize: "15px", fontWeight: "620" }, text: w.name }),
      h("div", { style: { fontSize: "13.6px", color: "var(--ink-2)", marginTop: "6px" }, text: w.summary }),
    );
    stage.append(head);

    const pipe = h("div", { class: "pipeline", style: { marginTop: "16px" } });
    w.steps.forEach((s, i) => pipe.append(stepEl(s, i)));
    stage.append(pipe);

    /* controls */
    const ctl = h("div", { class: "sim-controls" });
    const pw = h("div", { class: "progress-wrap" });
    const fill = h("div", { class: "progress-fill", style: { width: (cur / w.steps.length) * 100 + "%" } });
    pw.append(h("div", { class: "progress-bar" }, fill));
    pw.append(h("div", { class: "progress-txt", text: `stage ${Math.min(cur + 1, w.steps.length)} of ${w.steps.length} — ${w.steps[Math.min(cur, w.steps.length - 1)].title}` }));

    const prev = h("button", { class: "btn", type: "button", onclick: () => { cur = Math.max(0, cur - 1); render(); } }, "← Previous");
    const next = h("button", { class: "btn primary", type: "button", onclick: () => { cur = Math.min(w.steps.length - 1, cur + 1); render(); } }, "Next stage →");
    const play = h("button", { class: "btn", type: "button", onclick: () => { playing ? stop() : play_(); } }, playing ? "⏸ Pause" : "▶ Auto-run");

    ctl.append(prev, next, play, pw);
    stage.append(ctl);

    /* side panel */
    side.innerHTML = "";
    const s = w.steps[Math.min(cur, w.steps.length - 1)];
    const sc = card({ title: "Now running", sub: `stage ${s.n}` });
    sc.append(
      h("div", { style: { fontSize: "15.5px", fontWeight: "640", marginBottom: "8px" }, text: s.title }),
      kv([
        ["Executor", s.exec],
        ["Task state", s.state || "—"],
        ["Events", (s.ev || []).join(", ") || "—"],
        ["On failure", s.fail || "—"],
      ]),
    );
    if (s.note) sc.append(h("div", { style: { marginTop: "12px" } }, callout(s.note, s.key ? "" : "warn")));
    side.append(sc);

    const keySteps = w.steps.filter((x) => x.key);
    if (keySteps.length) {
      const kc = card({ title: "Load-bearing stages", sub: `${keySteps.length}`, cls: "" });
      kc.style.marginTop = "16px";
      kc.append(h("ul", { class: "list" }, ...keySteps.map((x) =>
        h("li", {}, h("span", { class: "dot" }), h("span", { html: `<b>${x.n}. ${esc(x.title)}</b><br><span style="font-size:12.6px">${esc(x.note || "")}</span>` })))));
      side.append(kc);
    }
  }

  function play_() {
    playing = true;
    const w = wf();
    timer = setInterval(() => {
      if (cur >= w.steps.length - 1) { stop(); return; }
      cur++; render();
    }, 1900);
    render();
  }
  function stop() { playing = false; clearInterval(timer); timer = null; }

  page.append(picker, h("div", { class: "grid", style: { gridTemplateColumns: "minmax(0,1fr) 400px", gap: "18px", alignItems: "start" } }, stage, side));

  /* failure classes */
  page.append(h("div", { class: "fade-in", style: { marginTop: "24px" } },
    card({ title: "Failure classes — what the factory does when things go wrong", sub: "the retry policy is decided by the failure's cause, not by the agent" },
      table(["Class", "Retries", "Outcome"], FAILURE_CLASSES.map((f) => ({
        cells: [f.id, f.retry, f.outcome],
      }))),
      h("div", { style: { marginTop: "14px" } },
        callout("<b>The most consequential finding in the corpus (V02):</b> hundreds of audited runs showed that workflow defects — not agent reasoning — caused the failures. So the thing to engineer is not the agent; it is the machine the agent runs inside. Note which rows retry <b>zero</b> times: <code>workflow.composition</code>, <code>context.insufficient</code>, <code>policy.denied</code> and <code>budget.exhausted</code>. A composition bug retried is still a composition bug."))
    )));

  buildPicker();
  render();
  return page;
}

/* ============================================================
   TASK STATE MACHINE
   ============================================================ */

export function renderStates() {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The state machine",
    "Nineteen states, thirty-four guarded transitions",
    "A task is a value in a finite state machine. Every transition has a guard, and the transition and its event are written in the same transaction — so the log can never disagree with the state. This is what makes a run reconstructable."
  ));

  /* layout: column by kind */
  const cols = [
    { kind: "start", label: "Start" },
    { kind: "active", label: "Active" },
    { kind: "human", label: "Human gate" },
    { kind: "terminal", label: "Terminal" },
    { kind: "later", label: "Later (v1 disabled)" },
  ];

  const svg = svgEl("svg", { class: "sm-svg", viewBox: "0 0 120 78", preserveAspectRatio: "xMidYMid meet" });

  const pos = {};
  const COLW = 24, ROWH = 9;
  cols.forEach((c, ci) => {
    const list = TASK_STATES.filter((s) => s.kind === c.kind);
    list.forEach((s, ri) => {
      pos[s.id] = { x: 3 + ci * COLW, y: 6 + ri * ROWH, w: 19, h: 6.4 };
    });
  });

  /* edges first */
  const gE = svgEl("g");
  const gN = svgEl("g");
  svg.append(gE, gN);

  TASK_TRANSITIONS.forEach(([from, to, guard]) => {
    if (from === "*nonTerminal*") return;
    const a = pos[from], b = pos[to];
    if (!a || !b) return;
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2, by = b.y + b.h / 2;
    const path = svgEl("path", { class: "sm-edge" + (guard ? " guard" : ""), d: `M ${ax} ${ay} C ${ax + (bx - ax) * .4} ${ay}, ${ax + (bx - ax) * .6} ${by}, ${bx} ${by}` });
    gE.append(path);
    if (guard) {
      const mx = (ax + bx) / 2 + 2.6, my = (ay + by) / 2;
      const t = svgEl("text", { class: "sm-elabel", x: mx, y: my });
      t.textContent = guard.length > 42 ? guard.slice(0, 40) + "…" : guard;
      t.setAttribute("text-anchor", "middle");
      gE.append(t);
    }
  });

  TASK_STATES.forEach((s) => {
    const p = pos[s.id];
    const grp = svgEl("g", { class: "sm-node " + s.kind });
    grp.append(svgEl("rect", { x: p.x, y: p.y, width: p.w, height: p.h }));
    const t = svgEl("text", { x: p.x + p.w / 2, y: p.y + (s.label || s.note ? 2.6 : 3.7) });
    t.textContent = s.id;
    grp.append(t);
    if (s.label || s.note) {
      const st = svgEl("text", { class: "sm-sub", x: p.x + p.w / 2, y: p.y + 4.9 });
      st.textContent = (s.label || s.note).slice(0, 30);
      grp.append(st);
    }
    gN.append(grp);
  });

  /* column headers */
  cols.forEach((c, ci) => {
    const list = TASK_STATES.filter((s) => s.kind === c.kind);
    if (!list.length) return;
    const t = svgEl("text", { x: 3 + ci * COLW + 9.5, y: 3.4, "text-anchor": "middle" });
    t.textContent = c.label.toUpperCase();
    t.setAttribute("font-size", "1.5");
    t.setAttribute("font-weight", "700");
    t.setAttribute("letter-spacing", ".1em");
    t.setAttribute("fill", "#6f7f9d");
    svg.append(t);
  });

  const wrap = h("div", { class: "sm-wrap" }, svg);
  page.append(h("div", { class: "card fade-in" }, wrap,
    h("div", { class: "sm-legend" },
      h("div", { class: "li" }, h("span", { class: "sw", style: { borderColor: "rgba(125,211,252,.6)" } }), "Start"),
      h("div", { class: "li" }, h("span", { class: "sw", style: { borderColor: "rgba(120,150,200,.5)" } }), "Active"),
      h("div", { class: "li" }, h("span", { class: "sw", style: { borderColor: "rgba(251,191,36,.55)" } }), "Human gate"),
      h("div", { class: "li" }, h("span", { class: "sw", style: { borderColor: "rgba(52,211,153,.5)" } }), "Terminal"),
      h("div", { class: "li" }, h("span", { class: "sw", style: { borderColor: "rgba(251,113,133,.5)" } }), "Failure"),
      h("div", { class: "li", style: { color: "var(--ink-3)" } }, "dashed edge = guarded transition (the guard text is the condition)"),
    )));

  /* node states */
  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } },
    card({ title: "Node states", sub: "one task node" },
      table(["State", ""], NODE_STATES.map((s) => ({ cells: [h("span", { class: "mono", text: s }), s === "LEASED" ? "held by a worker under lease" : s === "INCOMPLETE" ? "budget exhausted — partial artefacts preserved" : s === "BLOCKED" ? "dependency not satisfied" : ""] }))),
      h("div", { style: { marginTop: "12px" } }, callout("<b>FAILED → READY</b> is the only way back. A failed node is retried through the scheduler, never through the agent's own judgement."))
    ),
    card({ title: "Node transitions", sub: "10 of them" },
      table(["From", "To"], NODE_TRANSITIONS.map(([a, b]) => ({ cells: [h("span", { class: "mono", text: a }), h("span", { class: "mono", text: b })] }))))
  ));

  /* guard reference */
  const guards = TASK_TRANSITIONS.filter((t) => t[2]);
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Every guard, in one place", sub: `${guards.length} guarded transitions of ${TASK_TRANSITIONS.length}` },
      table(["Transition", "Guard (the condition that must hold)"], guards.map(([a, b, g]) => ({ cells: [h("span", { class: "mono", text: `${a} → ${b}` }), h("span", { class: "mono", style: { color: "var(--accent-2)" }, text: g })] }))))));

  return page;
}

/* ============================================================
   AGENTS
   ============================================================ */

export function renderAgents(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The agent catalogue",
    "Who does what, and what they are allowed to decide",
    "Agents are probabilistic. They interpret, generate and judge — inside a scope the control plane has authorised. No agent holds policy authority, and no agent ever holds a credential."
  ));

  const grid = h("div", { class: "grid g2" });
  AGENTS.forEach((a) => {
    const c = h("div", { class: "card click", onclick: () => openAgent(a) });
    c.append(
      h("div", { style: { display: "flex", gap: "9px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" } },
        tag(a.id, "a"), tag(a.exec, "v"), a.v1 === false ? tag("not in v1", "w") : tag("in v1", "g")),
      h("div", { style: { fontSize: "15.4px", fontWeight: "640" }, text: a.name }),
      h("div", { style: { fontSize: "13.3px", color: "var(--ink-2)", marginTop: "6px" }, text: a.note || a.scope || "" }),
      h("div", { style: { marginTop: "10px" } }, kv([["Class", a.cls], ["Model", a.model], ["Workflows", a.wf], ["Autonomy", a.autonomy || "L2 (default)"]])),
    );
    grid.append(c);
  });
  page.append(grid);

  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } },
    card({ title: "Roles deliberately excluded", sub: "not agents" },
      h("ul", { class: "list cross" }, ...EXCLUDED_ROLES.map((r) =>
        h("li", {}, h("span", { class: "dot" }),
          h("span", { html: typeof r === "string" ? `<b>${esc(r)}</b>` : `<b>${esc(r.role || r.name || r.t || "")}</b>${r.why ? " — " + esc(r.why) : ""}` })))),
      h("div", { style: { marginTop: "12px" } },
        callout("<b>Roles are specifications, not deployments.</b> The blueprint lists a catalogue of possible agent roles; the implementation pack narrows it to the ten that Workflows A–F actually need. Anything not needed is not built — that is how the agent count stays small enough to reason about."))),
    card({ title: "Workflow G's improvement chain", sub: "the self-improvement loop" },
      h("div", { class: "grid g3", style: { gap: "10px" } }, ...G_CHAIN.map((g, i) =>
        h("div", { class: "card pad-sm" },
          h("div", { class: "kicker", text: `stage ${i + 1}` }),
          h("div", { style: { fontSize: "14px", fontWeight: "620", marginTop: "3px" }, text: g }))),
      h("div", { style: { marginTop: "13px" } },
        callout("<b>The loop proposes; it never applies.</b> Batch evidence, never a single run. A proposed change goes through review, replay evaluation, approval at a scope-appropriate class, and an observation window with automatic rollback on a guardrail breach. There is no privileged path — not even for the factory itself."))
    )
  )));

  return page;
}

function openAgent(a) {
  drawerRecord("Agent role", a.name, [
    { p: a.note || a.scope || "" },
    { kv: [["ID", a.id], ["Executor", a.exec], ["Class", a.cls], ["Model tier", a.model], ["Workflows", a.wf], ["Autonomy", a.autonomy || "L2 — the default floor"], ["Scope", a.scope || "—"]] },
    { h: "The rule", p: "An agent may propose. It may never authorise. Every consequential action it proposes is re-checked by deterministic policy, and an action whose consequence exceeds its grant is escalated rather than executed." },
  ]);
}
