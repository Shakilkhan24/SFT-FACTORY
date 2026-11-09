/* ============================================================
   VIEW — Quality, verification and calibration
   The oracle is the gate; calibration is the proof the gate works
   ============================================================ */

import { h, svgEl } from "../dom.js";
import {
  LAYERS, COROLLARY, PRIMARY_GATE, PROPERTY_REQS, JUDGE_CONSTRAINTS,
  CALIB_THRESHOLDS, INJECTION_TECHNIQUES, PROMOTION_CONDS, RECALIB_INVALIDATORS,
  GATE_SETS, GATE_HEALTH, EVAL_LEVELS, EB_METRICS, EC_METRICS, EVAL_ELEMENTS,
  GUARDRAILS, SKILL_EVAL, MODEL_EVAL, WF_EVAL, CALIB_STEPS, AUTH_FLOW,
  GATE_SEQUENCE, REPLAY_FLOW, BASELINE_STEPS, QE_INVARIANTS, LIMITATIONS,
  METRICS, REDTEAM,
} from "../data/09-quality.js";
import { card, pageHead, callout, table, drawerRecord } from "./ui.js";
import { linkify } from "./refs.js";

export function renderQuality(params = {}) {
  const page = h("div", { class: "page" });

  page.append(pageHead(
    "Quality & verification",
    "The oracle is the gate",
    "A software factory can move fast and still be producing garbage — and it will look fine, because the agent that wrote the code is also the one asserting it works. This document closes that hole. The acceptance oracle is the primary merge gate; standards verifiers catch what the oracle does not; and calibration proves, with numbers, that the verifiers actually work before they are allowed to gate anything."
  ));

  /* --- the one rule, stated first --- */
  page.append(h("div", { class: "fade-in" },
    card({ title: "The one non-negotiable rule", sub: "FR-51" },
      h("div", {
        style: { fontSize: "17px", lineHeight: "1.5", fontWeight: "620" },
        html: "The acceptance oracle is the primary merge gate. <span style='color:var(--accent)'>A passing suite without a passing oracle does not merge.</span>",
      }),
      h("div", { style: { marginTop: "12px", fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65" }, text: "This is a single, simple rule with no exceptions carved out anywhere in the blueprint. It is the answer to the false-signal failure mode: an agent that is wrong about its own success." }))));

  /* --- the seven layers --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    renderLayers()));

  /* --- the oracle's three properties + authorship policy --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    renderOracle()));

  /* --- standards verifiers --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    renderVerifiers()));

  /* --- calibration --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    renderCalibration()));

  /* --- the merge gate --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    renderGate()));

  /* --- the evaluation framework --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    renderEvaluation()));

  /* --- baselines --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    renderBaseline()));

  /* --- metrics --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    renderMetrics()));

  /* --- red team --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    renderRedTeam()));

  /* --- invariants --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The twelve invariants of quality", sub: "QE-1 … QE-12" },
      table(["ID", "Invariant", "Enforced by"], QE_INVARIANTS.map((q) => ({
        fid: q.id,
        cells: [h("b", { class: "mono", text: q.id }), q.t, q.enf],
      }))))));

  /* --- limitations --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Known limitations", sub: "what this does not solve" },
      h("ol", { class: "list num" },
        LIMITATIONS.map((l) => h("li", {}, h("span", { class: "dot" }), h("span", { html: linkify(l.t) })))))));

  return page;
}

/* ============================================================
   §2 — THE SEVEN LAYERS
   ============================================================ */

function renderLayers() {
  const c = card({ title: "The layered test strategy", sub: "seven layers, and who owns each" });

  c.append(h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65", marginBottom: "12px" },
    html: "Per ADR-0005, the factory uses a layered suite, and each layer has an explicit <b>authorship policy</b> determining whether it may gate a merge." }));

  c.append(h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65", marginBottom: "12px" },
    html: "V12’s “90% of agent tests are slop” is an argument about <b>authorship</b>, not about <b>layers</b>. An E2E-only suite destroys fault localisation — a suite that only tells you <i>that</i> something broke, not <i>where</i>, cannot support automated repair, and automated repair is the factory’s core value. So the layering stays; <b>the authorship policy is the change</b>." }));

  /* the layer stack, top = narrowest */
  const stack = h("div", { class: "qly-stack" });
  LAYERS.forEach((l, i) => {
    const el = h("div", { class: "qly-tier", "data-fid": l.layer, onclick: () => openLayer(l) },
      h("div", { class: "qly-tier-n", text: String(i + 1) }),
      h("div", { class: "qly-tier-b" },
        h("div", { class: "qly-tier-name", text: l.layer }),
        h("div", { class: "qly-tier-role", text: l.role })),
      h("div", { class: "qly-tier-auth" },
        h("span", { class: "qly-auth-lbl", text: "authored by" }),
        h("span", { class: "qly-auth-val", text: l.auth })),
      h("div", { class: "qly-tier-gates" },
        h("span", { class: "qly-auth-lbl", text: "gates a merge?" }),
        h("span", { class: "qly-gates-val", text: l.gates })),
    );
    stack.append(el);
  });
  c.append(stack);

  /* the corollary — the layer rule in one sentence */
  c.append(h("div", { class: "qly-corollary" },
    h("div", { class: "kicker", text: "The corollary" }),
    h("div", { class: "qly-corollary-q", html: linkify(COROLLARY) })));

  return c;
}

function openLayer(l) {
  drawerRecord("Test layer", l.layer, [
    { kv: [["Role", l.role], ["Authored by", l.auth], ["Gates", l.gates]] },
    { p: "Click the layer in the stack to open this record." },
  ]);
}

/* ============================================================
   §2.3–§3 — THE ORACLE AND ITS AUTHORSHIP POLICY
   ============================================================ */

function renderOracle() {
  const c = card({ title: "The acceptance oracle", sub: "the specification made executable" });

  c.append(h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65", marginBottom: "12px" },
    html: linkify(PRIMARY_GATE) }));

  /* the three properties */
  c.append(h("div", { class: "kicker", style: { marginTop: "4px" }, text: "Three properties — an oracle must have all three" }));
  const props = h("div", { class: "grid g3", style: { gap: "11px", marginTop: "7px" } });
  [
    ["Independence", "Written against the specification, not the implementation. Not authored by the run that produced the implementation.", "Otherwise it asserts the implementation's behaviour."],
    ["Discrimination", "Demonstrated to fail when the property is violated.", "A test that always passes is not a test."],
    ["Completeness", "Every acceptance criterion has a corresponding oracle check.", "An unverified criterion is an unverified promise."],
  ].forEach(([n, req, why]) => {
    props.append(h("div", { class: "card pad-sm" },
      h("div", { style: { fontSize: "14px", fontWeight: "650", color: "var(--accent)" }, text: n }),
      h("div", { style: { fontSize: "13px", lineHeight: "1.55", marginTop: "7px" }, text: req }),
      h("div", { style: { fontSize: "12.2px", color: "var(--ink-3)", lineHeight: "1.5", marginTop: "7px", fontStyle: "italic" }, text: why })));
  });
  c.append(props);

  /* the authorship policy — interactive decision flow */
  c.append(h("div", { class: "kicker", style: { marginTop: "18px" }, text: "§2.4 — The authorship policy in the merge gate" }));
  c.append(renderAuthFlow());

  return c;
}

/* The authorship decision, as a live flow the reader can step through. */
function renderAuthFlow() {
  const wrap = h("div", { class: "qly-flow" });

  /* node kinds, read off the source diagram */
  const KIND = {
    P: { kind: "act" },
    Q: { kind: "dec" },
    FL: { kind: "warn" },
    OK: { kind: "ok" },
    R: { kind: "dec" },
    B: { kind: "bad" },
    S: { kind: "dec" },
    B2: { kind: "bad" },
    PASS: { kind: "ok" },
  };

  /* the edges, in source order */
  const EDGES = [
    ["P", "Q", ""],
    ["Q", "FL", "yes"],
    ["Q", "OK", "no"],
    ["FL", "R", ""],
    ["OK", "R", ""],
    ["R", "B", "no"],
    ["R", "S", "yes"],
    ["S", "B2", "yes"],
    ["S", "PASS", "no"],
  ];
  const LABEL = Object.fromEntries(AUTH_FLOW.map((n) => [n.id, n.label]));

  /* registries — direct references, so the render needs no live query engine */
  const optBtns = [];
  const edgeEls = [];
  const verdict = h("div", { class: "qly-verdict" });
  const chosenDecs = new Map();

  const rail = h("div", { class: "qly-rail" });

  /* ---- the graph ---- */
  const flow = h("div", { class: "qly-graph" });
  const g = svgEl("svg", { class: "qly-svg", viewBox: "0 0 340 300" });

  const defs = svgEl("defs");
  const marker = svgEl("marker", { id: "qly-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" });
  marker.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#3d5379" }));
  defs.append(marker);
  g.append(defs);

  /* positions: P -> Q -> {FL, OK} -> R -> {B, S} -> {B2, PASS} */
  const POS = {
    P: [170, 20], Q: [170, 70], FL: [80, 120], OK: [260, 120], R: [170, 175],
    B: [80, 225], S: [260, 225], B2: [215, 275], PASS: [305, 275],
  };
  const EOFF = {
    "Q->FL": [10, 12], "Q->OK": [-10, 12],
    "R->B": [-8, 14], "R->S": [8, 14],
    "S->B2": [-8, 10], "S->PASS": [8, 10],
  };

  EDGES.forEach(([from, to, lbl]) => {
    const [fx, fy] = POS[from], [tx, ty] = POS[to];
    const p = svgEl("path", {
      class: "qly-fedge",
      "data-edge": `${from}->${to}`,
      d: `M ${fx} ${fy} C ${fx} ${(fy + ty) / 2}, ${tx} ${(fy + ty) / 2}, ${tx} ${ty}`,
      "marker-end": "url(#qly-arrow)",
    });
    edgeEls.push(p);
    g.append(p);
    if (lbl) {
      const off = EOFF[`${from}->${to}`] || [0, 0];
      const mx = (fx + tx) / 2 + off[0], my = (fy + ty) / 2 + off[1];
      g.append(svgEl("text", { class: "qly-flabel", x: mx, y: my, "text-anchor": "middle" }, lbl));
    }
  });

  Object.entries(POS).forEach(([id, [x, y]]) => {
    const kind = (KIND[id] || {}).kind || "act";
    const grp = svgEl("g", { class: `qly-fnode ${kind}` });
    const label = (LABEL[id] || id).replace(/ → /g, " ");
    const lines = label.length > 26 ? label.split(/(?<=\.)\s|—/).slice(0, 3) : [label];
    const w = kind === "dec" ? 118 : 96, hgt = kind === "dec" ? 38 : 30;
    grp.append(svgEl("rect", { x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, rx: 6 }));
    lines.forEach((ln, i) => {
      const t = svgEl("text", { x, y: y + (i - (lines.length - 1) / 2) * 3.1, "text-anchor": "middle" });
      t.textContent = ln.length > 34 ? ln.slice(0, 33) + "…" : ln;
      grp.append(t);
    });
    g.append(grp);
  });

  flow.append(g, verdict);

  /* ---- the decisions ---- */
  const decision = (id, opts) => {
    const btns = opts.map(([k, v]) => {
      const b = h("button", {
        class: "qly-opt", type: "button", "data-opt": `${id}:${k}`,
        onclick: () => {
          optBtns.forEach((x) => x.classList.toggle("on", x.dataset.opt === `${id}:${k}`));
          chosenDecs.set(id, k);
          showPath();
        },
      }, h("span", { class: "qly-opt-k", text: k }), h("span", { class: "qly-opt-v", text: v }));
      optBtns.push(b);
      return b;
    });
    return h("div", { class: "qly-dec" },
      h("div", { class: "qly-dec-q", html: linkify(LABEL[id] || "") }),
      h("div", { class: "qly-dec-opts" }, btns));
  };

  /* ---- the verdict ---- */
  function showPath() {
    const chosen = new Set(chosenDecs.keys());

    edgeEls.forEach((e) => {
      const [from, to] = e.getAttribute("data-edge").split("->");
      const lit = chosen.has(from) && chosen.has(to);
      e.classList.toggle("lit", lit);
      e.classList.toggle("dim", chosen.size > 0 && !lit);
    });

    let state = null;
    if (chosen.has("Q")) {
      if (chosen.has("FL")) state = "warn";
      else if (chosen.has("OK")) state = "ok";
    }
    if (chosen.has("R")) {
      if (chosen.has("B")) state = "bad";
      else if (chosen.has("S")) {
        if (chosen.has("B2")) state = "bad";
        else if (chosen.has("PASS")) state = "ok";
      }
    }

    verdict.dataset.state = state || "";
    verdict.innerHTML = "";
    if (!state) {
      verdict.append(h("div", { class: "qly-verdict-t", text: "Answer the questions to see where the change lands." }));
      return;
    }
    const M = {
      warn: ["Needs review first", "An acceptance-oracle test was authored by the same run that produced the implementation. It is flagged untrusted and must be reviewed before it is allowed to gate. The change is not blocked — it is not trusted yet."],
      ok: ["May proceed to review", "The oracle passed, the test authorship was clean, and every other mandatory gate is green. The change is cleared for review. It has not been approved; it has earned the right to be looked at."],
      bad: ["BLOCKED", "The change does not merge. This holds regardless of how the rest of the suite performed."],
    }[state];
    verdict.append(
      h("div", { class: "qly-verdict-h", text: M[0] }),
      h("div", { class: "qly-verdict-b", text: M[1] }));
  }

  /* ---- the rail: source order of the decision tree ---- */
  rail.append(h("div", { class: "qly-step" },
    h("div", { class: "qly-step-n", text: "1" }),
    h("div", { class: "qly-step-b", html: linkify(LABEL.P) })));
  rail.append(decision("Q", [["yes", "Same run authored both"], ["no", "Independent authorship"]]));
  rail.append(decision("R", [["yes", "Oracle passes"], ["no", "Oracle fails"]]));
  rail.append(decision("S", [["yes", "Another gate fails"], ["no", "All mandatory gates pass"]]));

  wrap.append(h("div", { class: "grid g2", style: { gap: "14px" } }, rail, flow));
  wrap.append(h("div", { style: { marginTop: "10px" },
    html: "<span class='mono' style='font-size:11.4px;color:var(--ink-3)'>Pick a path — the highlighted edges and the verdict update live.</span>" }));

  showPath();
  return wrap;
}

/* ============================================================
   §4 — STANDARDS VERIFIERS
   ============================================================ */

function renderVerifiers() {
  const c = card({ title: "Standards verifiers", sub: "a standard with properties, not a linter with opinions" });

  c.append(h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65", marginBottom: "12px" },
    html: "A verifier is a mechanical check for a property the factory cares about. A verifier that has never been shown to fail on a real violation is not a verifier — it is decoration. That is what the calibration harness in the next section is for." }));

  /* the property requirements */
  c.append(h("div", { class: "kicker", text: "§4.3 — The property requirements" }));
  c.append(h("div", { class: "grid g2", style: { gap: "10px", marginTop: "7px" } },
    PROPERTY_REQS.map((p) => h("div", { class: "card pad-sm frec", "data-fid": p.req },
      h("div", { style: { fontSize: "13.6px", fontWeight: "640", color: "var(--accent-2)" }, text: p.req }),
      h("div", { style: { fontSize: "12.9px", color: "var(--ink-2)", lineHeight: "1.55", marginTop: "6px" }, text: p.why })))));

  /* LLM-judge constraints */
  c.append(h("div", { class: "kicker", style: { marginTop: "18px" }, text: "§4.4 — LLM-judge verifiers: the constraints that keep them honest" }));
  const jg = h("div", { class: "qly-judge", style: { marginTop: "7px" } });
  JUDGE_CONSTRAINTS.forEach((j, i) => {
    jg.append(h("div", { class: "qly-judge-row" },
      h("span", { class: "qly-judge-n", text: String(i + 1) }),
      h("span", { class: "qly-judge-c", text: j.c }),
      h("span", { class: "qly-judge-d", text: j.d })));
  });
  c.append(jg);

  return c;
}

/* ============================================================
   §5 — CALIBRATION
   ============================================================ */

function renderCalibration() {
  const c = card({ title: "Calibration — the discriminator test", sub: "prove the verifier works before you let it gate" });

  c.append(h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65", marginBottom: "12px" },
    html: "Calibration answers one question with numbers: <b>if this verifier meets a violation, will it catch it — and will it cry wolf otherwise?</b> A verifier that has not been calibrated may not gate. The harness runs both a positive corpus (known violations) and a negative control (conforming samples), because a verifier that flags everything catches everything and blocks everything." }));

  /* the interactive procedure */
  c.append(h("div", { class: "kicker", text: "§5.3 — The procedure" }));
  c.append(renderCalibLoop());

  /* thresholds */
  c.append(h("div", { class: "kicker", style: { marginTop: "18px" }, text: "§5.4 — The thresholds" }));
  c.append(h("div", { class: "qly-thresh", style: { marginTop: "7px" } },
    CALIB_THRESHOLDS.map((t) => h("div", { class: "qly-thresh-row" },
      h("div", { class: "qly-thresh-kind", text: t.kind }),
      h("div", { class: "qly-thresh-bars" },
        h("div", { class: "qly-bar-lbl" }, h("span", { text: "detection" }), h("b", { text: t.detect })),
        h("div", { class: "qly-bar-lbl" }, h("span", { text: "false positive" }), h("b", { text: t.fp })))))));

  /* injection techniques */
  c.append(h("div", { class: "kicker", style: { marginTop: "18px" }, text: "§5.6 — The violation-injection harness" }));
  c.append(table(["Injection technique", "What it gives you"], INJECTION_TECHNIQUES.map((t) => ({
    fid: t.tech, cells: [h("b", { text: t.tech }), t.gives],
  }))));

  /* promotion conditions */
  c.append(h("div", { class: "grid g2", style: { gap: "13px", marginTop: "16px" } },
    h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: "§5.7 — Calibration gates the autonomy promotion" }),
      h("ol", { class: "list num", style: { marginTop: "8px" } },
        PROMOTION_CONDS.map((p) => h("li", {}, h("span", { class: "dot" }), h("span", { html: linkify(p.t) }))))),
    h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: "§5.8 — Re-calibration is triggered by" }),
      h("ul", { class: "list cross", style: { marginTop: "8px" } },
        RECALIB_INVALIDATORS.map((r) => h("li", {}, h("span", { class: "dot" }), h("span", { html: linkify(r) })))))));

  return c;
}

/* The calibration loop, animated. */
function renderCalibLoop() {
  const wrap = h("div", { class: "qly-calib" });

  const notes = {
    S1: "The positive corpus. Historical fixes, synthetic injections and seeded defects — real violations the verifier is supposed to catch.",
    S2: "The negative control, and it is mandatory. Conforming samples that must not be flagged. Without them you cannot tell a detector from an alarm.",
    S3: "The verifier runs over the whole corpus, positives and negatives together.",
    S4: "Two numbers: recall on positives (detection rate) and the rate at which conforming code is flagged (false-positive rate).",
    S5: "Both thresholds must hold. A verifier that passes one and fails the other is not calibrated.",
    S6: "The verifier may now be part of the gate set — eligible to gate a change.",
    S7: "The verifier may NOT gate. Instead the failure raises a skill or harness proposal: the gap is a factory improvement, not a silent pass.",
    S8: "Re-run on a schedule, to detect regressions in the verifier itself as the codebase moves.",
  };

  const steps = CALIB_STEPS;
  const host = h("div", { class: "qly-calib-host" });

  let cur = 0, timer = null, playing = false;

  function paint() {
    const s = steps[cur];
    host.innerHTML = "";
    const det = h("div", { class: "qly-calib-detail" },
      h("div", { style: { display: "flex", gap: "10px", alignItems: "baseline", marginBottom: "8px" } },
        h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700", fontSize: "15px" }, text: s.id }),
        h("div", { style: { fontSize: "15px", fontWeight: "640" }, text: s.label })),
      h("div", { style: { fontSize: "13px", color: "var(--ink-2)", lineHeight: "1.6" }, text: notes[s.id] || "" }));
    host.append(det);
  }

  /* the loop ring */
  const ring = h("div", { class: "qly-ring" });
  const g = svgEl("svg", { class: "qly-ring-svg", viewBox: "0 0 240 240" });
  const defs = svgEl("defs");
  const mk = svgEl("marker", { id: "qly-carrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto" });
  mk.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#3d5379" }));
  defs.append(mk);
  g.append(defs);

  const R = 88, CX = 120, CY = 120;
  const ang = (i) => (i / steps.length) * Math.PI * 2 - Math.PI / 2;

  /* the loop-back arc, S8 -> S5 */
  g.append(svgEl("path", {
    class: "qly-carc",
    d: `M ${CX + R * Math.cos(ang(7) + 0.42)} ${CY + R * Math.sin(ang(7) + 0.42)} A ${R} ${R} 0 0 0 ${CX + R * Math.cos(ang(4) - 0.42)} ${CY + R * Math.sin(ang(4) - 0.42)}`,
    "marker-end": "url(#qly-carrow)",
  }));

  const nodes = [];
  steps.forEach((s, i) => {
    const x = CX + R * Math.cos(ang(i)), y = CY + R * Math.sin(ang(i));
    const grp = svgEl("g", { class: "qly-cnode", "data-step": s.id, onclick: () => { stop(); cur = i; paint(); mark(); } });
    grp.append(svgEl("circle", { cx: x, cy: y, r: 20 }));
    const t = svgEl("text", { x, y: y + 1.4, "text-anchor": "middle" });
    t.textContent = s.id;
    grp.append(t);
    const lbl = svgEl("text", { class: "qly-clabel", x, y: y + (y < CY ? -26 : 34), "text-anchor": "middle" });
    lbl.textContent = s.label.split(/[—,]/)[0].slice(0, 22);
    grp.append(lbl);
    g.append(grp);
    nodes.push(grp);
  });
  ring.append(g);

  function mark() {
    nodes.forEach((n, i) => {
      n.classList.toggle("now", i === cur);
      n.classList.toggle("done", i < cur);
    });
  }

  const ctl = h("div", { class: "sim-controls" });
  const prev = h("button", { class: "btn", type: "button", onclick: () => { stop(); cur = (cur - 1 + steps.length) % steps.length; paint(); mark(); } }, "← Previous");
  const next = h("button", { class: "btn primary", type: "button", onclick: () => { stop(); cur = (cur + 1) % steps.length; paint(); mark(); } }, "Next step →");
  const play = h("button", { class: "btn", type: "button", onclick: () => { playing ? stop() : go_(); } }, "▶ Run the calibration");
  const pw = h("div", { class: "progress-wrap" });
  const fill = h("div", { class: "progress-fill", style: { width: ((cur + 1) / steps.length) * 100 + "%" } });
  pw.append(h("div", { class: "progress-bar" }, fill));
  pw.append(h("div", { class: "progress-txt", text: `step ${cur + 1} of ${steps.length} — ${steps[cur].id}` }));
  ctl.append(prev, next, play, pw);

  function go_() {
    playing = true;
    play.textContent = "⏸ Pause";
    timer = setInterval(() => {
      cur = (cur + 1) % steps.length;
      paint(); mark();
      fill.style.width = ((cur + 1) / steps.length) * 100 + "%";
      pw.querySelector(".progress-txt").textContent = `step ${cur + 1} of ${steps.length} — ${steps[cur].id}`;
    }, 1800);
  }
  function stop() {
    playing = false;
    play.textContent = "▶ Run the calibration";
    clearInterval(timer); timer = null;
  }

  wrap.append(h("div", { class: "grid g2", style: { gap: "14px" } }, ring, host));
  wrap.append(ctl);
  paint(); mark();
  return wrap;
}

/* ============================================================
   §6 — THE MERGE GATE
   ============================================================ */

function renderGate() {
  const c = card({ title: "The merge gate", sub: "the set of gates a change must clear, by blast radius" });

  c.append(h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65", marginBottom: "12px" },
    html: "Not every change needs the full suite. The gate set scales with the <b>blast radius</b> — how far the change can reach if it is wrong. A typo in a comment and a change to the authorisation path are not the same class of risk, and the gate should not pretend they are." }));

  /* gate sets */
  c.append(table(["Tier", "Gates"], GATE_SETS.map((g) => ({
    fid: g.tier, cells: [h("b", { text: g.tier }), g.gates],
  }))));

  /* the sequence */
  c.append(h("div", { class: "kicker", style: { marginTop: "18px" }, text: "§6.2 — The gate sequence" }));
  c.append(renderGateSequence());

  /* gate health */
  c.append(h("div", { class: "grid g2", style: { gap: "13px", marginTop: "16px" } },
    h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: "§6.4 — The gate's own health" }),
      h("ul", { class: "list check", style: { marginTop: "8px" } },
        GATE_HEALTH.map((s) => h("li", {}, h("span", { class: "dot" }),
          h("span", { html: linkify(`<b>${s.sig}</b> — ${s.means}`) }))))),
    h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: "§6.3 — Gate weakening is itself a change" }),
      h("div", { style: { fontSize: "13px", color: "var(--ink-2)", lineHeight: "1.6", marginTop: "8px" },
        text: "Removing a gate, relaxing its threshold, or excluding a path from it is a change to the factory's definition — and travels the same reviewed path as any other change. The gate cannot be edited by the thing it gates." }))));

  return c;
}

/* The gate sequence, as a numbered swim of actors. */
function renderGateSequence() {
  const wrap = h("div", { class: "qly-seq" });

  /* actors in the order the source declares them */
  const ACTORS = ["CH", "AUTH", "ORC", "ST", "SEC", "INT", "VR", "REV", "PAN", "GATE"];
  const NAME = {
    CH: "Change", AUTH: "Authorship Check", ORC: "Oracle", ST: "Static/Type/Lint",
    SEC: "Security Scan", INT: "Integration", VR: "Standards Verifiers",
    REV: "Reviewer", PAN: "Panel", GATE: "Merge Gate",
  };
  const ORDER = new Map(ACTORS.map((a, i) => [a, i]));

  const msgs = GATE_SEQUENCE.map((m, i) => ({ ...m, i }));
  /* the oracle's verdict is the one the source marks PRIMARY */
  const isPrimary = (m) => /PRIMARY/.test(m.msg);

  const list = h("div", { class: "qly-seq-list" });
  msgs.forEach((m) => {
    const toGate = m.to === "GATE";
    const row = h("div", {
      class: "qly-seq-row" + (toGate ? " to-gate" : "") + (isPrimary(m) ? " primary" : ""),
      "data-fid": m.msg,
    },
      h("span", { class: "qly-seq-n", text: String(m.i + 1).padStart(2, "0") }),
      h("span", { class: "qly-seq-from", text: NAME[m.from] || m.from }),
      h("span", { class: "qly-seq-arrow", text: m.from === m.to ? "↺" : "→" }),
      h("span", { class: "qly-seq-to", text: NAME[m.to] || m.to }),
      h("span", { class: "qly-seq-msg", text: m.msg }));
    list.append(row);
  });

  /* actor rail across the top */
  const rail = h("div", { class: "qly-seq-rail" });
  ACTORS.forEach((a) => {
    rail.append(h("div", { class: "qly-seq-actor" },
      h("div", { class: "qly-seq-a-name", text: NAME[a] }),
      h("div", { class: "qly-seq-a-id", text: a })));
  });

  wrap.append(rail, list);
  wrap.append(h("div", { style: { marginTop: "10px" },
    html: "<span class='mono' style='font-size:11.4px;color:var(--ink-3)'>The oracle's verdict is the one that carries <b>PRIMARY</b> — everything else is subordinate to it.</span>" }));
  return wrap;
}

/* ============================================================
   §7 — THE EVALUATION FRAMEWORK
   ============================================================ */

function renderEvaluation() {
  const c = card({ title: "The evaluation framework", sub: "four levels, and what each one is for" });

  /* the four levels */
  c.append(table(["Level", "What it evaluates", "Method", "Cadence"], EVAL_LEVELS.map((l) => ({
    fid: l.id, cells: [h("b", { text: l.id }), l.what, l.method, l.cadence],
  }))));

  /* the four elements */
  c.append(h("div", { class: "grid g2", style: { gap: "13px", marginTop: "16px" } },
    h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: "§7.5 — The four elements of every evaluation report" }),
      h("ul", { class: "list num", style: { marginTop: "8px" } },
        EVAL_ELEMENTS.map((e) => h("li", {}, h("span", { class: "dot" }),
          h("span", { html: linkify(`<b>${e.e}</b> — ${e.req}`) }))))),
    h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: "§7.4 — E-D: evaluating a configuration change" }),
      h("div", { style: { fontSize: "13px", color: "var(--ink-2)", lineHeight: "1.6", marginTop: "8px" },
        text: "Every change to the definition is evaluated by replay, not by opinion." }),
      h("div", { class: "qly-mini-flow", style: { marginTop: "10px" } },
        REPLAY_FLOW.map((r, i) => h("div", { class: "qly-mini-node", "data-fid": r.id },
          h("div", { class: "qly-mini-l", text: r.label }),
          i < REPLAY_FLOW.length - 1 ? h("div", { class: "qly-mini-arrow", text: "→" }) : null))))));

  /* E-B and E-C metrics */
  c.append(h("div", { class: "kicker", style: { marginTop: "18px" }, text: "§7.2 — E-B: evaluating an agent" }));
  c.append(table(["Metric", "What it tells you", "Affects"], EB_METRICS.map((m) => ({
    fid: m.m, cells: [h("b", { text: m.m }), m.d, m.at],
  }))));

  c.append(h("div", { class: "kicker", style: { marginTop: "18px" }, text: "§7.3 — E-C: evaluating a workflow" }));
  c.append(table(["Metric", "What it tells you", "Why it is measured"], EC_METRICS.map((m) => ({
    fid: m.m, cells: [h("b", { text: m.m }), m.d, m.why],
  }))));

  /* guardrails */
  c.append(h("div", { class: "kicker", style: { marginTop: "18px" }, text: "§7.6 — Guardrails" }));
  c.append(h("div", { class: "grid g2", style: { gap: "9px", marginTop: "7px" } },
    GUARDRAILS.map((g) => h("div", { class: "card pad-sm frec", "data-fid": g.g },
      h("div", { style: { fontSize: "13.2px", fontWeight: "640" }, text: g.g }),
      h("div", { style: { fontSize: "12.4px", color: "var(--ink-2)", lineHeight: "1.5", marginTop: "5px" }, text: g.vs })))));

  /* the three per-objective frameworks */
  const fr = h("div", { class: "grid g3", style: { gap: "12px", marginTop: "18px" } });
  [
    ["§7.7 — Skills", SKILL_EVAL],
    ["§7.8 — Models", MODEL_EVAL],
    ["§7.9 — Workflows", WF_EVAL],
  ].forEach(([title, rows]) => {
    const cc = h("div", { class: "card pad-sm" });
    cc.append(h("div", { class: "kicker", text: title }));
    const ul = h("ul", { class: "list", style: { marginTop: "8px" } });
    rows.forEach((r) => ul.append(h("li", {}, h("span", { class: "dot" }),
      h("span", { html: linkify(`<b>${r.m}</b> — ${r.d}`) }))));
    cc.append(ul);
    fr.append(cc);
  });
  c.append(fr);

  return c;
}

/* ============================================================
   §9 — BASELINES
   ============================================================ */

function renderBaseline() {
  const c = card({ title: "Baseline establishment", sub: "a change with no baseline is not evidence" });

  c.append(h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65", marginBottom: "12px" },
    html: "Baselines are established <b>before</b> any promotion, and the procedure is the same for every metric." }));

  const steps = h("div", { class: "qly-baseline" });
  BASELINE_STEPS.forEach((s) => {
    steps.append(h("div", { class: "qly-baseline-step" },
      h("div", { class: "qly-baseline-n", text: String(s.n) }),
      h("div", { class: "qly-baseline-l", text: s.label })));
  });
  c.append(steps);

  c.append(h("div", { class: "grid g2", style: { gap: "13px", marginTop: "16px" } },
    h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: "§9.2 — What a baseline is not" }),
      h("div", { style: { fontSize: "13px", color: "var(--ink-2)", lineHeight: "1.6", marginTop: "8px" },
        text: "A baseline is not a target, and not a comparison to a vendor's published figure. It is the factory's own measurement of itself — on a stated workload, over a stated window, with its confounders recorded." })),
    h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: "§9.3 — The initial baseline source" }),
      h("div", { style: { fontSize: "13px", color: "var(--ink-2)", lineHeight: "1.6", marginTop: "8px" },
        text: "Where the factory has no history, the baseline comes from the pre-factory workflow — the human team's cycle time, defect rate and review load. Measured once, at the start. It is a reference point, not a control group." }))));

  return c;
}

/* ============================================================
   §8 — THE METRIC CATALOGUE
   ============================================================ */

function renderMetrics() {
  const c = card({ title: "The metric catalogue", sub: "23 metrics, each with a definition, a collection point, an owner and a threshold" });

  c.append(h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65", marginBottom: "12px" },
    html: "MEAS-05 requires each metric to have a definition, a collection point, an owner, and a threshold at which it triggers action. <b>MEAS-02: telemetry is emitted by the framework, not by agents</b> — an agent under pressure to succeed is the least reliable narrator of its own performance." }));

  /* filter chips by owner */
  const owners = [...new Set(METRICS.map((m) => m.owner))];
  const filterRow = h("div", { class: "qly-filter" });
  const tbody = h("tbody", {});

  const mkRow = (m) => {
    const tr = h("tr", { class: "frec", "data-fid": m.name, "data-owner": m.owner },
      h("td", { class: "mono", style: { color: "var(--ink-3)" }, text: m.n }),
      h("td", {}, h("b", { text: m.name }), h("div", { style: { fontSize: "12.2px", color: "var(--ink-3)" }, text: m.def })),
      h("td", { text: m.collect }),
      h("td", {}, h("span", { class: "tag", text: m.owner })),
      h("td", { text: m.thresh }));
    tbody.append(tr);
    return tr;
  };

  const rows = METRICS.map(mkRow);

  const allChip = h("button", { class: "qly-chip on", type: "button", onclick: () => {
    filterRow.querySelectorAll(".qly-chip").forEach((c) => c.classList.remove("on"));
    allChip.classList.add("on");
    rows.forEach((r) => { r.style.display = ""; });
  } }, `All ${METRICS.length}`);
  filterRow.append(allChip);

  owners.forEach((o) => {
    const chip = h("button", { class: "qly-chip", type: "button", onclick: () => {
      filterRow.querySelectorAll(".qly-chip").forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
      rows.forEach((r) => { r.style.display = r.dataset.owner === o ? "" : "none"; });
    } }, `${o} (${METRICS.filter((m) => m.owner === o).length})`);
    filterRow.append(chip);
  });

  c.append(filterRow);

  const t = h("table", { class: "tbl" });
  t.append(h("thead", {}, h("tr", {},
    h("th", { text: "#" }), h("th", { text: "Metric" }), h("th", { text: "Collection point" }),
    h("th", { text: "Owner" }), h("th", { text: "Action threshold" }))));
  t.append(tbody);

  c.append(h("div", { class: "tbl-scroll" }, t));

  c.append(h("div", { style: { marginTop: "12px" } },
    callout("Thresholds are deliberately unset for the outcome metrics. Per ADR-0011 §6, <b>no target is set from any figure in the research corpus</b>. A threshold is set only after the factory establishes its own baseline — and where one is listed, it is a <i>process</i> threshold (a re-calibration window, a rate that indicates a broken mechanism) rather than a productivity target.")));

  return c;
}

/* ============================================================
   §10 — RED TEAM
   ============================================================ */

function renderRedTeam() {
  const c = card({ title: "Red team and adversarial testing", sub: "AT-1 … AT-15" });

  c.append(h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)", lineHeight: "1.65", marginBottom: "12px" },
    html: "The security controls are only as good as their verification. This suite tests them directly — and it is a <b>required check in the factory's own CI</b>. A failure blocks a release of the factory, which means the factory is held to the same standard it holds the product to." }));

  c.append(table(["ID", "Attack", "Expected behaviour"], REDTEAM.map((a) => ({
    fid: a.rid, cells: [h("b", { class: "mono", text: a.id }), a.attack, a.expect],
  }))));

  return c;
}
