/* ============================================================
   VIEW — Context, skills, prompts and memory
   The fourth commitment's machinery: what an agent knows, and when.
   ============================================================ */

import { h, svgEl, esc } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, tag, callout, table, drawerRecord, kv, prose, proseSpan, fid } from "./ui.js";
import { linkify } from "./refs.js";

import {
  PRINCIPLES, NOT_CONTEXT, FIELDS, TRUST_CLASSES, PRIVILEGED_RULES,
  TIER_COMPARE, PRECEDENCE, PROMOTION, SKILL_VS_STANDARD, DERIVE_TEST,
  QUALITY_RULES, LIFECYCLE_STATES, LIFECYCLE_EDGES, LIFECYCLE_RULES,
  OUTER_LOOP, META_LOOP, ASSEMBLER_IFACE, ASSEMBLER_STEPS, ASSEMBLER_EDGES,
  DETERMINISM, ORDERING, INVENTORY, MEMORY_CLASSES, CLASS1_ATTRS, CLASS3_ATTRS,
  CLASS_TEST, PROMPT_PARTS, PROMPT_RULES, INJECTION_CONTROLS, CX_INVARIANTS, LIMITATIONS,
} from "../data/07-context.js";

/* ============================================================
   1. THE ASSEMBLER — an animated pipeline
   ============================================================ */

export function renderContext(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "What an agent knows",
    "The context model — the fourth commitment made mechanical",
    "Context is selected, never maximal. It is pinned per run, it is authority-bearing, and it resolves in one place with deterministic precedence. This is the machinery behind commitment C3 — and the reason the factory can be loud about what it does not know."
  ));

  page.append(renderAssembler());

  /* --- the four principles --- */
  const pg = h("div", { class: "grid g4" });
  PRINCIPLES.forEach((p) => {
    pg.append(h("div", { class: "card pad-sm frec", "data-fid": p.id },
      h("div", { style: { display: "flex", gap: "8px", alignItems: "baseline" } },
        h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700" }, text: p.id }),
        h("div", { style: { fontSize: "13.6px", fontWeight: "640", lineHeight: "1.35" }, text: p.name })),
      h("div", { style: { fontSize: "12.6px", color: "var(--ink-2)", marginTop: "9px" }, text: p.consequence })));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "20px" } },
    card({ title: "Four principles", sub: "each one becomes a mechanism" }, pg)));

  /* --- precedence cascade --- */
  page.append(renderPrecedence());

  /* --- two tiers --- */
  const tg = h("div", { class: "grid g2" });
  TIER_COMPARE.forEach((r) => {
    tg.append(h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: r.k }),
      h("div", { style: { fontSize: "12.9px", marginTop: "6px" } },
        h("div", { style: { color: "var(--accent)" }, text: "Repository-local" }),
        h("div", { style: { color: "var(--ink-2)", marginTop: "3px" }, text: r.local })),
      h("div", { style: { fontSize: "12.9px", marginTop: "9px" } },
        h("div", { style: { color: "var(--accent-2)" }, text: "Central" }),
        h("div", { style: { color: "var(--ink-2)", marginTop: "3px" }, text: r.central }))));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The two tiers", sub: "where context lives, and how it changes" },
      tg,
      h("div", { style: { marginTop: "14px" } },
        callout("<b>The partition rule is one sentence:</b> context whose truth is a property of the <i>repository</i> lives in the repository; context whose truth is a property of the <i>organisation</i> lives centrally. Everything else — precedence, promotion, demotion — follows from that split.")))));

  /* --- what context is not --- */
  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } },
    card({ title: "What context is not", sub: "three false readings" },
      h("ul", { class: "list cross" }, ...NOT_CONTEXT.map((n) =>
        h("li", {}, h("span", { class: "dot" }),
          h("span", { html: `Not ${esc(n.it)} — <b style="color:var(--ink)">${esc(n.is)}</b>` }))))),
    card({ title: "The context item", sub: "the unit of everything above" },
      table(["Field", "Required", "Why it exists"], FIELDS.map((f) => ({
        cells: [h("span", { class: "mono", text: f.f }), f.req, f.why],
      }))),
      h("div", { style: { marginTop: "12px" } },
        callout("Every field is load-bearing. <code>version</code> makes a run reproducible; <code>sha256</code> makes tampering detectable; <code>trust.classification</code> decides whether the item can carry instruction at all; <code>trust.privileged</code> decides whether an agent may touch it.")))
  ));

  /* --- trust classification --- */
  page.append(renderTrust());

  /* --- skills --- */
  page.append(renderSkills());

  /* --- memory --- */
  page.append(renderMemory());

  /* --- prompt --- */
  page.append(renderPrompt());

  /* --- inventory --- */
  page.append(renderInventory());

  /* --- invariants --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The context invariants", sub: `${CX_INVARIANTS.length} guarantees, each with its enforcement` },
      table(["ID", "Invariant", "Enforcement"], CX_INVARIANTS.map((c) => ({
        fid: c.id,
        cells: [h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "600" }, text: c.id }), h("b", { text: c.t }), c.enf],
      }))))));

  /* --- limitations --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Known limitations", sub: "stated, not hidden" },
      h("ol", { class: "list num" }, ...LIMITATIONS.map((l) =>
        h("li", {}, h("span", { class: "dot" }), h("span", { html: linkify(l.t) })))))));

  return page;
}

/* ============================================================
   THE ASSEMBLER — interactive, step-through
   ============================================================ */

function renderAssembler() {
  const wrap = h("div", { class: "fade-in" });
  const cardEl = card({ title: "The context assembler", sub: "a pure function that decides what one stage is allowed to know" });
  wrap.append(cardEl);

  cardEl.append(h("div", { style: { fontSize: "13.6px", color: "var(--ink-2)", marginBottom: "12px" } },
    h("span", { class: "mono", style: { color: "var(--accent-2)" }, text: "resolve(stageSpec, taskInputs, repoScope) → ContextEnvelope" }),
  ));

  /* --- interface --- */
  const iface = h("div", { class: "grid g2", style: { gap: "12px", marginBottom: "16px" } });
  const inEl = h("div", { class: "card pad-sm" });
  inEl.append(h("div", { class: "kicker", text: "Inputs" }));
  inEl.append(kv(ASSEMBLER_IFACE.inputs.map((x) => [x.k, x.src])));
  const outEl = h("div", { class: "card pad-sm" });
  outEl.append(h("div", { class: "kicker", text: "Output — the context envelope" }));
  outEl.append(kv(ASSEMBLER_IFACE.outputs.map((x) => [x.k, x.v])));
  iface.append(inEl, outEl);
  cardEl.append(iface);

  /* --- the stepper --- */
  const steps = ASSEMBLER_STEPS;
  const stepHost = h("div", {});
  const rail = h("div", { class: "ctx-rail" });

  let cur = 0;
  let timer = null;
  let playing = false;

  function paint() {
    const s = steps[cur];
    stepHost.innerHTML = "";
    rail.innerHTML = "";

    steps.forEach((st, i) => {
      const node = h("div", {
        class: "ctx-node" + (i === cur ? " now" : "") + (i < cur ? " done" : ""),
        onclick: () => { stop(); cur = i; paint(); },
      },
        h("div", { class: "ctx-n", text: st.n }),
        h("div", { class: "ctx-l", text: st.label }),
      );
      rail.append(node);
      if (i < steps.length - 1) {
        rail.append(h("div", { class: "ctx-link" + (i < cur ? " done" : "") }));
      }
    });

    /* detail panel */
    const det = h("div", { class: "ctx-detail" });
    det.append(
      h("div", { style: { display: "flex", gap: "9px", alignItems: "baseline", marginBottom: "10px" } },
        h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700", fontSize: "15px" }, text: "step " + s.n }),
        h("div", { style: { fontSize: "15px", fontWeight: "640" }, text: s.label })),
    );

    /* per-step explanation, drawn from the source */
    const notes = STEP_NOTES[s.n] || [];
    if (notes.length) {
      const ul = h("ul", { class: "list" });
      notes.forEach((n) => ul.append(h("li", {}, h("span", { class: "dot" }), h("span", { html: linkify(n) }))));
      det.append(ul);
    }
    stepHost.append(det);
  }

  /* controls */
  const ctl = h("div", { class: "sim-controls" });
  const prev = h("button", { class: "btn", type: "button", onclick: () => { stop(); cur = Math.max(0, cur - 1); paint(); } }, "← Previous");
  const next = h("button", { class: "btn primary", type: "button", onclick: () => { stop(); cur = Math.min(steps.length - 1, cur + 1); paint(); } }, "Next step →");
  const play = h("button", { class: "btn", type: "button", onclick: () => { playing ? stop() : go_(); } }, playing ? "⏸ Pause" : "▶ Run the assembler");
  const pw = h("div", { class: "progress-wrap" });
  const fill = h("div", { class: "progress-fill", style: { width: (cur / steps.length) * 100 + "%" } });
  pw.append(h("div", { class: "progress-bar" }, fill));
  pw.append(h("div", { class: "progress-txt", text: `step ${cur + 1} of ${steps.length}` }));
  ctl.append(prev, next, play, pw);
  cardEl.append(rail, stepHost, ctl);

  function go_() {
    playing = true;
    timer = setInterval(() => {
      if (cur >= steps.length - 1) { stop(); return; }
      cur++; paint();
    }, 1500);
    paint();
  }
  function stop() { playing = false; clearInterval(timer); timer = null; }

  paint();

  /* the budget rule deserves its own callout */
  wrap.append(h("div", { class: "fade-in", style: { marginTop: "14px" } },
    card({ title: "The budget rule — the one that matters most", sub: "fail loudly, never truncate" },
      h("div", { style: { fontSize: "14px", lineHeight: "1.6" }, html: "If the resolved envelope exceeds the configured budget, the stage fails with <code>context.budget_exceeded</code>. <b>It does not truncate.</b>" }),
      h("div", { style: { fontSize: "13.2px", color: "var(--ink-2)", marginTop: "10px", lineHeight: "1.6" }, text: "Truncation produces an envelope that looks complete and is not. The agent then reasons from a partial picture and produces output that satisfies its misunderstanding. The failure is silent — and silent failure is the failure mode the calibration harness exists to detect." }),
      h("div", { class: "grid g2", style: { marginTop: "14px", gap: "12px" } },
        h("div", { class: "card pad-sm" },
          h("div", { class: "kicker", text: "Recovery" }),
          h("div", { style: { fontSize: "12.9px", color: "var(--ink-2)" }, text: "The failure classification is context.insufficient — zero retries. The remediation is to fix the context sources or the trigger evaluator, and the improvement loop treats it as a skill-scope signal." })),
        h("div", { class: "card pad-sm" },
          h("div", { class: "kicker", text: "Units" }),
          h("div", { style: { fontSize: "12.9px", color: "var(--ink-2)" }, text: "The budget is measured in bytes, not tokens, because tokenisation varies by provider and the budget must be provider-independent. A token estimate is derived for the model in use, but the decision is made in bytes." }))))));

  /* determinism table */
  wrap.append(h("div", { class: "fade-in", style: { marginTop: "14px" } },
    card({ title: "Determinism and pinning", sub: "why a run can be reconstructed years later" },
      table(["Property", "Mechanism"], DETERMINISM.map((d) => ({
        cells: [h("b", { text: d.p }), d.m],
      }))))));

  return wrap;
}

/* Per-step notes, drawn from the source document's own explanation. */
const STEP_NOTES = {
  "1": ["Filter to privileged items from the policy tier — the policy tier contributes only what changes what an agent may do.", "Central security and compliance policy is non-overridable by any repository."],
  "2": ["Select candidates by appliesTo: paths, repositories, taskTypes. An item that does not apply is not context cost."],
  "3": ["Resolve precedence: central security > repository-local > central > policy. Exactly one place."],
  "4": ["Tag untrusted content and mark derived items. The untrusted-content classification is applied at ingest, not at read — if an item could reach an agent untagged, the boundary is broken."],
  "5": ["Standards contribute a property set; procedures contribute steps. The distinction decides how they are selected and whether a verifier can be generated."],
  "6": ["Order is deterministic and significant, because position in a prompt affects attention. Policy, standards, procedures, reference, local context — and untrusted content always last."],
  "7": ["Full tool definitions and long references become deferred references: an identifier, a summary and a retrieval handle. The agent has the index at all times and the content on demand."],
  "8": ["If over budget, re-select by relevance score and check again. Still over budget → fail with context.budget_exceeded."],
  "8a": ["The relevance ordering here is heuristic. A stage that repeatedly fails on budget means the selection rules need tuning — the failure is loud and classified, unlike a silent truncation."],
};

/* ============================================================
   PRECEDENCE CASCADE
   ============================================================ */

function renderPrecedence() {
  const wrap = h("div", { class: "fade-in", style: { marginTop: "18px" } });
  const cardEl = card({ title: "Precedence", sub: "four rules, resolved in one place, deterministically" });
  wrap.append(cardEl);

  /* the cascade, drawn as a vertical stack of bands */
  const stack = h("div", { class: "prec-stack" });
  const bands = [
    { label: "Central security & compliance policy", note: "always wins — a repository cannot override it", cls: "b1" },
    { label: "Repository-local context", note: "wins for repository-scoped concerns", cls: "b2" },
    { label: "Central context", note: "standards, contracts, shared integration contracts", cls: "b3" },
    { label: "General agent policy", note: "fallback — and the gap is flagged", cls: "b4" },
  ];
  bands.forEach((b) => {
    stack.append(h("div", { class: "prec-band " + b.cls },
      h("div", { class: "prec-l", text: b.label }),
      h("div", { class: "prec-n", text: b.note })));
    stack.append(h("div", { class: "prec-arrow", text: "▼ higher priority" }));
  });
  cardEl.append(stack);

  const rules = h("div", { style: { marginTop: "14px" } });
  PRECEDENCE.forEach((p) => {
    rules.append(h("div", { class: "prec-rule" },
      h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700" }, text: p.n }),
      h("div", {},
        h("b", { text: p.rule }),
        h("div", { style: { fontSize: "13px", color: "var(--ink-2)", marginTop: "3px" }, text: p.detail }))));
  });
  cardEl.append(rules);

  /* promotion / demotion */
  cardEl.append(h("div", { class: "kicker", style: { marginTop: "16px" }, text: "Promotion and demotion — both reviewed, never automatic" }));
  cardEl.append(table(["Direction", "Trigger", "Effect", "Approval"], PROMOTION.map((p) => ({
    cells: [h("b", { text: p.dir }), p.trigger, p.effect, p.approval],
  }))));
  cardEl.append(h("div", { style: { marginTop: "12px" } },
    callout("The local copy becomes a <b>pointer</b>, not a deletion — so promotion is visible in the repository's own diff. That visible diff is the property that makes repository-local context trustworthy.")));

  return wrap;
}

/* ============================================================
   TRUST + PRIVILEGE
   ============================================================ */

function renderTrust() {
  const g = h("div", { class: "grid g3" });
  TRUST_CLASSES.forEach((t) => {
    const cls = t.cls === "trusted" ? "g" : t.cls === "untrusted-content" ? "w" : "v";
    g.append(h("div", { class: "card pad-sm frec", "data-fid": t.cls },
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, tag(t.cls, cls)),
      h("div", { style: { fontSize: "12.9px", color: "var(--ink-2)", marginTop: "9px" }, text: t.meaning }),
      h("div", { style: { fontSize: "12.6px", marginTop: "9px", color: "var(--ink)" }, text: t.handling })));
  });

  const priv = h("div", { style: { marginTop: "14px" } });
  priv.append(h("div", { class: "kicker", text: "Privileged context — a context item that changes what an agent may do" }));
  const ul = h("ul", { class: "list check" });
  PRIVILEGED_RULES.forEach((r) => ul.append(h("li", {}, h("span", { class: "dot" }), h("span", { html: linkify(r) }))));
  priv.append(ul);
  priv.append(h("div", { style: { marginTop: "12px" } },
    callout("<b>A prompt that says \"run this command\" is a capability grant written in English.</b> If privileged context can be modified by any party with write access to a repository, the capability grant is unauditable. So privileged context cannot be authored or modified by an agent, requires the elevated review class, is recorded with its provenance, and is integrity-checked on every load.")));

  return h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Trust classification", sub: "applied at ingest, never at read" }, g, priv));
}

/* ============================================================
   SKILLS
   ============================================================ */

function renderSkills() {
  const wrap = h("div", { class: "fade-in", style: { marginTop: "18px" } });

  /* skill vs standard */
  const sv = h("div", { class: "grid g2" });
  SKILL_VS_STANDARD.forEach((r) => {
    sv.append(h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: r.k }),
      h("div", { style: { fontSize: "12.9px", marginTop: "6px" } },
        h("div", { style: { color: "var(--accent)" }, text: "Procedure" }),
        h("div", { style: { color: "var(--ink-2)", marginTop: "2px" }, text: r.procedure })),
      h("div", { style: { fontSize: "12.9px", marginTop: "8px" } },
        h("div", { style: { color: "var(--accent-2)" }, text: "Standard" }),
        h("div", { style: { color: "var(--ink-2)", marginTop: "2px" }, text: r.standard }))));
  });

  /* derive-don't-inject */
  const ddi = h("div", { class: "grid g2", style: { marginTop: "14px", gap: "10px" } });
  DERIVE_TEST.bad.forEach((bad, i) => {
    ddi.append(h("div", { class: "card pad-sm" },
      h("div", { style: { fontSize: "12.6px", color: "var(--bad)" }, html: "✕ " + esc(bad) }),
      h("div", { style: { fontSize: "12.6px", color: "var(--good)", marginTop: "7px" }, html: "✓ " + esc(DERIVE_TEST.good[i] || "") })));
  });

  const c1 = card({ title: "Skill or standard?", sub: "two kinds of context item, stored the same way" },
    sv,
    h("div", { class: "kicker", style: { marginTop: "16px" }, text: "The derive-don't-inject test" }),
    h("div", { style: { fontSize: "13.2px", color: "var(--ink-2)", marginTop: "5px", lineHeight: "1.6" }, html: linkify(DERIVE_TEST.test) }),
    ddi,
    h("div", { style: { marginTop: "12px" } },
      callout("The right-hand column is also the <b>version-stable</b> one — it survives the fact changing, so the version bump is not required. A skill that states a fact the agent could compute is both wrong and a maintenance liability.")));
  wrap.append(c1);

  /* quality rules */
  const qr = h("div", { class: "grid g2", style: { marginTop: "14px" } });
  QUALITY_RULES.forEach((r) => {
    qr.append(h("div", { class: "card pad-sm" },
      h("div", { style: { fontSize: "13.6px", fontWeight: "640" }, text: r.rule }),
      h("div", { style: { fontSize: "12.8px", color: "var(--ink-2)", marginTop: "6px" }, text: r.test }),
      h("div", { class: "mono", style: { fontSize: "10.8px", color: "var(--ink-3)", marginTop: "7px" }, text: r.source })));
  });
  wrap.append(h("div", { class: "fade-in", style: { marginTop: "14px" } },
    card({ title: "Skill quality rules", sub: `${QUALITY_RULES.length} rules, each with a test` }, qr)));

  /* lifecycle */
  wrap.append(h("div", { class: "fade-in", style: { marginTop: "14px" } },
    card({ title: "The skill lifecycle", sub: "a skill is never applied by a running agent" },
      renderLifecycle(),
      h("div", { style: { marginTop: "14px" } },
        h("ol", { class: "list num" }, ...LIFECYCLE_RULES.map((r) =>
          h("li", {}, h("span", { class: "dot" }), h("span", { html: linkify(r.t) }))))))));

  /* the improvement loops */
  wrap.append(h("div", { class: "fade-in", style: { marginTop: "14px" } },
    card({ title: "Two loops, two scopes", sub: "the outer loop improves a skill; the meta loop proposes changes to the harness itself" },
      h("div", { class: "grid g2", style: { gap: "14px" } },
        h("div", {},
          h("div", { class: "kicker", text: "Outer loop — a skill" }),
          h("ol", { class: "list num" }, ...OUTER_LOOP.map((s) =>
            h("li", {}, h("span", { class: "dot" }),
              h("span", { html: `<b>${esc(s.stage)}</b> — ${esc(s.what)}` }))))),
        h("div", {},
          h("div", { class: "kicker", text: "Meta loop — the harness" }),
          table(["Property", "Requirement"], META_LOOP.map((m) => ({
            cells: [h("b", { text: m.k }), m.v],
          }))),
          h("div", { style: { marginTop: "12px" } },
            callout("<b>The meta loop is not permitted to write to the harness.</b> It emits a proposal that enters the same reviewed-change path as any other change. There is no privileged path — not even for the factory itself.")))))));

  return wrap;
}

/* lifecycle as an SVG state diagram */
function renderLifecycle() {
  const states = LIFECYCLE_STATES;
  const svg = svgEl("svg", { class: "lc-svg", viewBox: "0 0 340 150", preserveAspectRatio: "xMidYMid meet" });
  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "lc-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5",
    markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse",
  });
  marker.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--line-2)" }));
  defs.append(marker);
  svg.append(defs);
  const gE = svgEl("g");
  const gN = svgEl("g");
  svg.append(gE, gN);

  /* lay the states out in a ring so the edges read as a cycle */
  const N = states.length;
  const cx = 170, cy = 74, R = 55;
  const pos = {};
  states.forEach((s, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    pos[s] = { x: cx + Math.cos(a) * R * 1.55, y: cy + Math.sin(a) * R * 0.72 };
  });

  LIFECYCLE_EDGES.forEach((e) => {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) return;
    const ax = a.x, ay = a.y, bx = b.x, by = b.y;
    const mx = (ax + bx) / 2, my = (ay + by) / 2 - 8;
    gE.append(svgEl("path", {
      class: "lc-edge",
      d: `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`,
    }));
  });

  states.forEach((s) => {
    const p = pos[s];
    const grp = svgEl("g", { class: "lc-node " + (s === "REJECTED" ? "bad" : s === "ACTIVE" ? "good" : "") });
    grp.append(svgEl("rect", { x: p.x - 30, y: p.y - 7, width: 60, height: 14, rx: 3 }));
    const t = svgEl("text", { x: p.x, y: p.y + 2.4 });
    t.textContent = s;
    t.setAttribute("text-anchor", "middle");
    grp.append(t);
    gN.append(grp);
  });

  return h("div", { class: "lc-wrap" }, svg);
}

/* ============================================================
   MEMORY
   ============================================================ */

function renderMemory() {
  const g = h("div", { class: "grid g4" });
  MEMORY_CLASSES.forEach((c) => {
    g.append(h("div", { class: "card pad-sm frec", "data-fid": "Class " + c.id },
      h("div", { class: "kicker", text: "Class " + c.id }),
      h("div", { style: { fontSize: "13.4px", fontWeight: "640", marginTop: "4px", lineHeight: "1.35" }, text: c.label.replace(/^Class \d — /, "") }),
      h("ul", { class: "list", style: { marginTop: "9px" } },
        ...c.boxes.map((b) => h("li", {}, h("span", { class: "dot" }), h("span", { text: b }))))));
  });

  const clsTest = h("div", { style: { marginTop: "16px" } });
  clsTest.append(h("div", { class: "kicker", text: "The classification test" }));
  clsTest.append(h("div", { style: { fontSize: "13.6px", marginTop: "6px", lineHeight: "1.55", color: "var(--ink)" }, text: CLASS_TEST.q }));
  const mg = h("div", { class: "grid g4", style: { marginTop: "10px", gap: "8px" } });
  (CLASS_TEST.maps || []).forEach((m) => {
    mg.append(h("div", { class: "card pad-sm" },
      h("div", { style: { fontSize: "12.4px", color: "var(--ink-2)" }, text: m.from }),
      h("div", { style: { fontSize: "12.8px", color: "var(--accent)", fontWeight: "600", marginTop: "4px" }, text: "→ " + m.to })));
  });
  clsTest.append(mg);

  return h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Memory — four classes", sub: "the word \"memory\" is used loosely; the blueprint separates it" },
      g, clsTest,
      h("div", { style: { marginTop: "14px" } },
        callout("<b>Class 3 is not a vector store.</b> A vector database is rejected as a dependency: approximate retrieval must never be authoritative. Knowledge retrieval is keyword- and structure-based — topic, component, change link, time. Semantic similarity may rank a keyword-filtered candidate set, but it may never be the retrieval mechanism.")),
      h("div", { class: "grid g2", style: { marginTop: "14px", gap: "12px" } },
        h("div", { class: "card pad-sm" },
          h("div", { class: "kicker", text: "Class 1 — run artefacts" }),
          kv(CLASS1_ATTRS.map((a) => [a.k, a.v]))),
        h("div", { class: "card pad-sm" },
          h("div", { class: "kicker", text: "Class 3 — knowledge" }),
          kv(CLASS3_ATTRS.map((a) => [a.k, a.v]))))));
}

/* ============================================================
   PROMPT
   ============================================================ */

function renderPrompt() {
  const wrap = h("div", { class: "fade-in", style: { marginTop: "18px" } });

  /* the ten parts, as a stack */
  const stack = h("div", { class: "prompt-stack" });
  PROMPT_PARTS.forEach((p) => {
    const isUntrusted = p.n === 10;
    stack.append(h("div", { class: "prompt-part" + (isUntrusted ? " untrusted" : "") },
      h("div", { class: "pp-n", text: String(p.n) }),
      h("div", {},
        h("div", { class: "pp-t", text: p.title }),
        h("div", { class: "pp-d", text: p.detail }))));
  });

  const rules = h("div", { class: "grid g2", style: { marginTop: "14px", gap: "10px" } });
  PROMPT_RULES.forEach((r) => {
    rules.append(h("div", { class: "card pad-sm" },
      h("div", { style: { fontSize: "13.2px", fontWeight: "640" }, text: r.rule }),
      h("div", { style: { fontSize: "12.5px", color: "var(--ink-3)", marginTop: "5px" }, html: linkify(r.reason) })));
  });

  /* injection controls table */
  const ctrls = h("div", { style: { marginTop: "14px" } });
  ctrls.append(h("div", { class: "kicker", text: "Where the injection defence actually lives" }));
  ctrls.append(table(["Control", "Layer", "Effective?"], INJECTION_CONTROLS.map((c) => {
    const eff = c.eff.toLowerCase();
    const cls = eff.startsWith("yes") ? "g" : eff.startsWith("partially") ? "w" : "";
    return { cells: [c.c, h("span", { class: "tag " + cls, text: c.layer }), c.eff] };
  })));

  wrap.append(card({ title: "Prompt construction", sub: "the prompt is an artefact of the harness, not of the agent" },
    h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", marginBottom: "14px", lineHeight: "1.6" }, text: "The agent does not write its own prompt. The assembler and the role specification determine it — which is what makes the run reproducible and the context auditable. The assembled prompt is hashed and recorded in the run artefact." }),
    h("div", { class: "grid g2", style: { gap: "16px", alignItems: "start" } },
      stack,
      h("div", {}, rules)),
    ctrls,
    h("div", { style: { marginTop: "14px" } },
      callout("<b>The architecture does not rely on the model resisting injection.</b> It relies on the fact that an injected instruction can only cause the agent to <i>propose</i> an action — and every consequential action passes through the deterministic policy engine and, where the blast radius warrants it, a human who can see the injected content.", "good"))));

  return wrap;
}

/* ============================================================
   INVENTORY
   ============================================================ */

function renderInventory() {
  const g = h("div", { class: "grid g2" });
  INVENTORY.forEach((f) => {
    const sev = f.sev.toLowerCase();
    const cls = sev === "error" ? "bad" : sev === "warning" ? "w" : "";
    g.append(h("div", { class: "card pad-sm" },
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
        h("span", { style: { fontSize: "13.6px", fontWeight: "640" }, text: f.f }),
        tag(f.sev, cls)),
      h("div", { style: { fontSize: "12.7px", color: "var(--ink-2)", marginTop: "7px" }, text: f.def }),
      h("div", { style: { fontSize: "12.5px", marginTop: "7px", color: "var(--ink-3)" }, html: "<b>Remediation:</b> " + esc(f.fix) })));
  });

  return h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The context inventory", sub: "a background scan, not an agent" },
      g,
      h("div", { style: { marginTop: "14px" } },
        callout("<b>The count of duplicate and stale findings is tracked over time and must be non-increasing.</b> That is the metric which distinguishes a maintained context corpus from an accumulating one. A corpus that only grows raises the selection problem, dilutes attention, and eventually makes selection arbitrary.")),
      h("div", { style: { marginTop: "12px" } },
        callout("<b>The scan is code, not an agent.</b> An agent may interpret a finding and propose a fix; it may not generate the finding list. This preserves the same split of authority as the rest of the blueprint."))));
}
