/* ============================================================
   Cross-reference resolver
   Turns an ID like "I-4", "ADR-0005", "T-2.14", "AT-9", "AP-3"
   into a clickable link that navigates to the right view.
   ============================================================ */

import { h, esc } from "../dom.js";
import { DATA } from "../data/index.js";
import { CX_INVARIANTS } from "../data/07-context.js";
import { QE_INVARIANTS, REDTEAM } from "../data/09-quality.js";
import { navigate } from "../router.js";

const { BP, INVARIANTS, ATTACKS, TICKETS, SPIKES, PEAK_STUBS, GATES, AGENTS, ACCESS_POINTS, ALGORITHMS, AUTONOMY, TIERS, ISOLATION, EFFECT_CLASSES, TASK_STATES, FAILURE_CLASSES, BOUNDARY_RULES, COVERAGE, INV_TESTS } = DATA;

/* id → { view, params, label, kind } */
const RESOLVERS = [];

function reg(re, view, params, label, kind) {
  RESOLVERS.push({ re, view, params: params || {}, label, kind });
}

const anchor = (re) => new RegExp(re, "i");

/* invariants */
INVARIANTS.forEach((i) => reg(anchor(`^${i.id}$`), "guarantees", { focus: i.id }, i.t, "Invariant"));
/* attacks */
ATTACKS.forEach((a) => reg(anchor(`^${a.id}$`), "guarantees", { focus: a.id }, a.name, "Attack"));
/* ADRs */
(BP.ADRS || []).forEach((a) => reg(anchor(`^${a.n}$`), "decisions", { focus: a.n }, a.title, "ADR"));
/* owner decisions */
(BP.DECISIONS || []).forEach((d) => reg(anchor(`^${d.id}$`), "decisions", { focus: d.id }, d.q, "Decision"));
/* questions + hypotheses */
(BP.QUESTIONS || []).forEach((q) => reg(anchor(`^${q.id}$`), "decisions", { focus: q.id }, q.q, "Question"));
(BP.HYPOTHESES || []).forEach((x) => reg(anchor(`^${x.id}$`), "decisions", { focus: x.id }, x.t, "Hypothesis"));
/* risks */
(BP.RISKS || []).forEach((r) => reg(anchor(`^${r.id}$`), "risks", { focus: r.id }, r.t, "Risk"));
(BP.PACK_RISKS || []).forEach((r) => reg(anchor(`^${r.id}$`), "risks", { focus: r.id }, r.t, "Risk"));
/* tickets + spikes + peak stubs */
TICKETS.forEach((t) => reg(anchor(`^${t.id}$`), "roadmap", { focus: t.id }, t.title, "Ticket"));
SPIKES.forEach((s) => reg(anchor(`^${s.id}$`), "roadmap", { focus: s.id }, s.q, "Spike"));
PEAK_STUBS.forEach((s) => reg(anchor(`^${s.id}$`), "roadmap", { focus: s.id }, s.title, "Ticket"));
/* gates */
GATES.forEach((g) => reg(anchor(`^${g.id}$`), "roadmap", { focus: g.id }, g.name, "Gate"));
/* PRD */
(DATA.PRD || []).forEach((p) => reg(anchor(`^${p.id}$`), "roadmap", { focus: p.id }, p.t, "Readiness"));
/* agents */
AGENTS.forEach((a) => reg(anchor(`^${a.id}$`), "agents", { focus: a.id }, a.name, "Agent"));
/* access points */
ACCESS_POINTS.forEach((a) => reg(anchor(`^${a.id}$`), "access", { focus: a.id }, a.verb, "Access point"));
/* algorithms */
ALGORITHMS.forEach((a) => reg(anchor(`^${a.id}$`), "algorithms", { focus: a.id }, a.name, "Algorithm"));
/* dials */
AUTONOMY.forEach((a) => reg(anchor(`^${a.id}$`), "levels", { focus: a.id }, a.name, "Autonomy"));
TIERS.forEach((t) => reg(anchor(`^${t.id}$`), "levels", { focus: t.id }, t.name, "Tier"));
ISOLATION.forEach((t) => reg(anchor(`^${t.id}$`), "levels", { focus: t.id }, t.name, "Isolation"));
EFFECT_CLASSES.forEach((t) => reg(anchor(`^${t.id}$`), "levels", { focus: t.id }, t.name, "Effect class"));
/* task states */
TASK_STATES.forEach((s) => reg(anchor(`^${s.id}$`), "states", { focus: s.id }, s.label || s.note || "", "Task state"));
/* failure classes */
FAILURE_CLASSES.forEach((f) => reg(anchor(`^${f.id.replace(/\./g, "\\.")}$`), "workflows", { focus: "failures" }, f.outcome, "Failure class"));
/* commitments */
DATA.COMMITMENTS.forEach((c) => reg(anchor(`^${c.id}$`), "commitments", { focus: c.id }, c.title, "Commitment"));
/* workflows */
DATA.WORKFLOWS.forEach((w) => reg(anchor(`^Workflow ${w.id}$`), "workflows", { focus: w.id }, w.name, "Workflow"));
/* target stacks */
(BP.TARGET_STACKS || []).forEach((s) => reg(anchor(`^${s.name}$`), "stacks", {}, s.name, "Stack"));
/* requirements (FR / SEC) */
(COVERAGE || []).forEach((c) => reg(anchor(`^${c.id}$`), "coverage", { focus: c.id },
  c.n || c.id, c.id.startsWith("SEC") ? "Security requirement" : "Requirement"));
/* invariant test inventory */
(INV_TESTS || []).forEach((t) => reg(anchor(`^${t.id}$`), "coverage", { focus: t.id }, t.t, "Invariant test"));
/* trust-zone boundary rules */
(BOUNDARY_RULES || []).forEach((b) => reg(anchor(`^${b.id}$`), "map", { focusZone: "Z3" }, b.text, "Boundary rule"));
/* context invariants CX-1..CX-9 */
(CX_INVARIANTS || []).forEach((c) => reg(anchor(`^${c.id}$`), "context", { focus: c.id }, c.t, "Context invariant"));

/* quality invariants QE-1..QE-12 */
(QE_INVARIANTS || []).forEach((q) => reg(anchor(`^${q.id}$`), "quality", { focus: q.id }, q.t, "Quality invariant"));

/* red-team suite RT-1..RT-15 — the source labels these AT-n, but doc 03
   already owns AT-n for a different catalogue, so these resolve under RT-n */
(REDTEAM || []).forEach((a) => reg(anchor(`^${a.rid}$`), "quality", { focus: a.rid }, a.attack, "Red-team attack"));

/* ---- generic token matching inside prose ---- */
/* Tokens that look like IDs anywhere in free text.
   Order matters: longer / more specific forms come first. */
const TOKEN = /\b(ADR-\d{4}|INV-\d{1,2}|FR-\d{1,3}|SEC-\d{1,2}|CL-G\d-\d{2}|CX-\d{1,2}|QE-\d{1,2}|RT-\d{1,2}|I-\d{1,2}|AT-\d{1,2}|T-\d+\.\d{2}|S-\d+|RP-\d+|R-\d{2}|Q-\d{2}|H-\d{2}|D\d{1,2}|AP-\d|PRD-\d+|G_CHAIN|B-\d|L\d|R\d|T\d|E\d|G\d)\b/g;

export function resolve(id) {
  const s = String(id || "").trim();
  for (const r of RESOLVERS) if (r.re.test(s)) return r;
  return null;
}

/**
 * Render text with cross-reference links.
 * `text` may contain HTML already — IDs inside it become clickable spans.
 */
export function linkify(text) {
  const src = String(text ?? "");
  // Avoid touching content inside existing tags
  const parts = src.split(/(<[^>]+>)/);
  let out = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1) { out += part; return; }  // an HTML tag — pass through
    out += part.replace(TOKEN, (m) => {
      const r = resolve(m);
      if (!r) return m;
      return `<span class="xref" data-view="${esc(r.view)}" data-params="${esc(JSON.stringify(r.params))}" title="${esc(r.kind + ": " + r.label)}">${esc(m)}</span>`;
    });
  });
  return out;
}

/** A single chip that navigates. */
export function xref(id, opts = {}) {
  const r = resolve(id);
  const label = opts.label || (r ? r.label : id);
  const el = h("span", {
    class: "xref" + (opts.cls ? " " + opts.cls : ""),
    title: r ? `${r.kind} — ${label}` : String(id),
    onclick: (e) => {
      e.stopPropagation();
      if (r) navigate(r.view, r.params);
    },
  }, opts.text || id);
  return el;
}

/** Install a global click handler for .xref[data-view] spans produced by linkify(). */
export function installXrefClicks(root) {
  root.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target.closest(".xref[data-view]") : null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    let params = {};
    try { params = JSON.parse(t.getAttribute("data-params") || "{}"); } catch {}
    navigate(t.getAttribute("data-view"), params);
  });
}
