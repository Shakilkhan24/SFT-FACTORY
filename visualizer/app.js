/* ============================================================
   SOFTWARE FACTORY — visualizer shell
   ============================================================ */

import { DATA } from "./data/index.js";
import { h } from "./dom.js";
import { closeDrawer } from "./drawer.js";
import { defineTabs, getTabs, go, navigate, renderTabs, currentTab } from "./router.js";
import { registerViews } from "./views/index.js";
import { getTour } from "./tour.js";
import { installXrefClicks } from "./views/refs.js";
import * as CTX from "./data/07-context.js";
import { TEMPLATES } from "./data/08-templates.js";
import * as QE from "./data/09-quality.js";

const {
  META, COMMITMENTS, ZONES, NODES, WORKFLOWS, TASK_STATES, AGENTS, ACCESS_POINTS,
  AUTONOMY, TIERS, ISOLATION, EFFECT_CLASSES, INJECTION_CONTROLS, THREAT_ACTORS,
  FAILURE_CLASSES, TICKETS, SPIKES, GATES, INVARIANTS, ATTACKS, ALGORITHMS, BP,
} = DATA;

export { DATA, navigate, currentTab };

/* ---------- global search index ---------- */

const SEARCH_INDEX = [];

function push(kind, id, title, detail, onOpen) {
  const t = String(title ?? "");
  const d = String(detail ?? "");
  SEARCH_INDEX.push({
    kind, id, title: t, detail: d, onOpen,
    hay: (t + " " + d + " " + id).toLowerCase(),
  });
}

export function buildSearchIndex() {
  SEARCH_INDEX.length = 0;

  NODES.forEach((n) => {
    const z = ZONES.find((zz) => zz.id === n.zone);
    push("Component", n.id, n.label, `${n.sub} · ${z ? z.name : n.zone}`, () => navigate("map", { focus: n.id }));
  });
  ZONES.forEach((z) => push("Zone", z.id, `Zone ${z.id} — ${z.name}`, z.summary, () => navigate("map", { focusZone: z.id })));
  COMMITMENTS.forEach((c) => push("Commitment", c.id, c.title, c.detail, () => navigate("commitments", { focus: c.id })));
  WORKFLOWS.forEach((w) => push("Workflow", w.id, `Workflow ${w.id} — ${w.name}`, w.summary, () => navigate("workflows", { focus: w.id })));
  TASK_STATES.forEach((s) => push("Task state", s.id, s.id, s.label || s.note || "", () => navigate("states")));
  AGENTS.forEach((a) => push("Agent", a.id, a.name, `${a.exec} · ${a.cls} · ${a.wf}`, () => navigate("agents", { focus: a.id })));
  ACCESS_POINTS.forEach((a) => push("Access point", a.id, `${a.id} ${a.name}`, a.verb + " — " + a.body, () => navigate("access", { focus: a.id })));
  AUTONOMY.forEach((a) => push("Autonomy", a.id, `${a.id} ${a.name}`, a.can, () => navigate("levels")));
  TIERS.forEach((t) => push("Tier", t.id, `${t.id} ${t.name}`, `score ${t.score} · ${t.gates}`, () => navigate("levels")));
  ISOLATION.forEach((t) => push("Isolation", t.id, `${t.id} ${t.name}`, t.what, () => navigate("levels")));
  EFFECT_CLASSES.forEach((t) => push("Effect class", t.id, `${t.id} ${t.name}`, t.rule, () => navigate("levels")));
  INVARIANTS.forEach((i) => push("Invariant", i.id, `${i.id} ${i.t}`, i.proof, () => navigate("guarantees", { focus: i.id })));
  ATTACKS.forEach((a) => push("Attack", a.id, `${a.id} ${a.name}`, a.desc, () => navigate("guarantees", { focus: a.id })));
  GATES.forEach((g) => push("Gate", g.id, `${g.id} ${g.name}`, g.when, () => navigate("gates", { focus: g.id })));
  TICKETS.forEach((t) => push("Ticket", t.id, `${t.id} ${t.title}`, `${t.epic} · ${t.wk} · ${t.size} · ${t.tier}`, () => navigate("roadmap", { focus: t.id })));
  SPIKES.forEach((s) => push("Spike", s.id, `${s.id} ${s.title || s.name || ""}`, s.detail || s.d || "", () => navigate("roadmap", { focus: s.id })));
  (BP.ADRS || []).forEach((a) => push("ADR", a.n, `${a.n} ${a.title}`, a.decision, () => navigate("decisions", { focus: a.n })));
  (BP.DECISIONS || []).forEach((d) => push("Decision", d.id, `${d.id} ${d.q}`, d.def, () => navigate("decisions", { focus: d.id })));
  (BP.QUESTIONS || []).forEach((q) => push("Question", q.id, `${q.id} ${q.q || q.question || ""}`, q.a || q.ans || "", () => navigate("decisions", { focus: q.id })));
  (BP.HYPOTHESES || []).forEach((x) => push("Hypothesis", x.id, `${x.id} ${x.h || x.t || ""}`, x.d || x.why || "", () => navigate("decisions", { focus: x.id })));
  (BP.RISKS || []).forEach((r) => push("Risk", r.id, `${r.id} ${r.t || r.title || r.name || ""}`, r.d || r.impact || "", () => navigate("risks", { focus: r.id })));
  (BP.PACK_RISKS || []).forEach((r) => push("Risk", r.id, `${r.id} ${r.t || r.title || r.name || ""}`, r.d || r.impact || "", () => navigate("risks", { focus: r.id })));
  (BP.GLOSSARY || []).forEach((g) => push("Glossary", g.t, g.t, g.d, () => navigate("glossary", { focus: g.t })));
  ALGORITHMS.forEach((a) => push("Algorithm", a.id || a.n, a.name || a.t || "", a.d || a.what || "", () => navigate("algorithms", { focus: a.id || a.n })));
  FAILURE_CLASSES.forEach((f) => push("Failure class", f.id, f.id, `${f.retry} · ${f.outcome}`, () => navigate("workflows")));
  INJECTION_CONTROLS.forEach((c) => push("Injection control", `IC-${c.n}`, `${c.n}. ${c.name}`, c.what, () => navigate("security", { focus: c.n })));
  THREAT_ACTORS.forEach((t) => push("Threat actor", t.id, `${t.id} ${t.name}`, t.how, () => navigate("security")));
  (BP.METRICS || []).forEach((g) => (g.m || []).forEach((m) =>
    push("Metric", m, `${m}`, `group: ${g.g}`, () => navigate("metrics"))));
  (BP.WEEK_PLAN || []).forEach((w) => push("Week", w.wk, `${w.wk} — ${w.theme}`, w.exit, () => navigate("roadmap")));
  (BP.TARGET_STACKS || []).forEach((s) => push("Stack", s.name, s.name, `install: ${s.install || ""} · test: ${s.test || ""}`, () => navigate("stacks")));
  (BP.TABLES || []).forEach((t) => push("Table", t.id || t.name, t.id || t.name, t.d || t.what || t.purpose || "", () => navigate("data")));
  (BP.API || []).forEach((a) => push("API", a.id || a.method || a.path, `${a.method || ""} ${a.path || a.id || ""}`.trim(), a.d || a.what || "", () => navigate("data")));
  (BP.INTEGRATIONS || []).forEach((i) => push("Integration", i.id || i.name, i.id || i.name, i.d || i.what || "", () => navigate("data")));
  /* coverage matrix + registers */
  (DATA.COVERAGE || []).forEach((c) => push("Requirement", c.id, c.id, c.n || `status: ${DATA.COVERAGE_STATUS[c.s].label} · proved by ${c.tk}`, () => navigate("coverage", { focus: c.id })));
  (DATA.INV_TESTS || []).forEach((t) => push("Invariant test", t.id, `${t.id} — ${t.t}`, `proved at ${t.at}`, () => navigate("coverage", { focus: t.id })));
  (DATA.DEFERRALS || []).forEach((d) => push("Deferral", d.item, d.item, `${d.why} · trigger: ${d.trig}`, () => navigate("coverage")));
  (DATA.FRIDAY || []).forEach((f) => push("Checkpoint", f.q, f.q, f.a, () => navigate("coverage")));
  /* consistency ledger */
  (DATA.CONFLICTS || []).forEach((c) => push("Conflict", c.id, `${c.topic}`, `${c.claim} — ${c.verdict}`, () => navigate("consistency", { focus: c.id })));
  /* context model */
  CTX.CX_INVARIANTS.forEach((c) => push("Context invariant", c.id, `${c.id} ${c.t}`, c.enf, () => navigate("context", { focus: c.id })));
  CTX.PRINCIPLES.forEach((p) => push("Context principle", "context " + p.id, `${p.id} — ${p.name}`, p.consequence, () => navigate("context", { focus: p.id })));
  CTX.MEMORY_CLASSES.forEach((c) => push("Memory class", "Class " + c.id, c.label, c.boxes.join(" · "), () => navigate("context", { focus: "Class " + c.id })));
  CTX.TRUST_CLASSES.forEach((t) => push("Trust class", t.cls, t.cls, t.meaning, () => navigate("context", { focus: t.cls })));
  CTX.INVENTORY.forEach((f) => push("Inventory finding", f.f, f.f, `${f.def} · severity ${f.sev}`, () => navigate("context")));
  CTX.QUALITY_RULES.forEach((q) => push("Skill rule", q.rule, q.rule, q.test, () => navigate("context")));
  CTX.PROMPT_PARTS.forEach((p) => push("Prompt part", "P" + p.n, `${p.n}. ${p.title}`, p.detail, () => navigate("context")));
  /* authoring templates */
  TEMPLATES.forEach((t) => push("Template", t.file, t.title, t.useWhen, () => navigate("templates", { focus: t.file })));
  /* quality & verification */
  QE.QE_INVARIANTS.forEach((q) => push("Quality invariant", q.id, `${q.id} ${q.t}`, q.enf, () => navigate("quality", { focus: q.id })));
  QE.LAYERS.forEach((l) => push("Test layer", l.layer, l.layer, `${l.role} · authored by ${l.auth}`, () => navigate("quality", { focus: l.layer })));
  QE.EVAL_LEVELS.forEach((l) => push("Evaluation level", l.id, `${l.id} — ${l.what}`, `${l.method} · ${l.cadence}`, () => navigate("quality", { focus: l.id })));
  QE.GATE_SETS.forEach((g) => push("Gate set", g.tier, g.tier, g.gates, () => navigate("quality", { focus: g.tier })));
  QE.CALIB_THRESHOLDS.forEach((t) => push("Calibration threshold", t.kind, t.kind, `detection ${t.detect} · false positive ${t.fp}`, () => navigate("quality")));
  QE.METRICS.forEach((m) => push("Metric", m.name, `${m.n}. ${m.name}`, `${m.def} · owner ${m.owner} · threshold ${m.thresh}`, () => navigate("quality", { focus: m.name })));
  QE.REDTEAM.forEach((a) => push("Red-team attack", a.rid, `${a.id} — ${a.attack}`, a.expect, () => navigate("quality", { focus: a.rid })));
  QE.JUDGE_CONSTRAINTS.forEach((j) => push("LLM-judge constraint", j.c, j.c, j.d, () => navigate("quality")));
}

/* ---------- search UI ---------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function highlight(text, needle) {
  const s = String(text ?? "");
  const idx = s.toLowerCase().indexOf(needle);
  if (idx < 0) return escapeHtml(s);
  return escapeHtml(s.slice(0, idx)) + "<mark>" + escapeHtml(s.slice(idx, idx + needle.length)) + "</mark>" + escapeHtml(s.slice(idx + needle.length));
}

function initSearch() {
  const input = document.getElementById("search");
  const out = document.getElementById("search-results");
  if (!input || !out) return;
  let sel = 0, hits = [];

  const close = () => { out.hidden = true; hits = []; sel = 0; };

  const render = (q) => {
    if (!q || q.length < 2) { close(); return; }
    const needle = q.toLowerCase();
    hits = SEARCH_INDEX.filter((s) => s.hay.includes(needle)).slice(0, 40);
    out.innerHTML = "";
    if (!hits.length) {
      out.append(h("div", { class: "sr-empty", text: `No match for “${q}”` }));
      out.hidden = false;
      return;
    }
    const groups = [];
    hits.forEach((hit) => {
      let g = groups.find((x) => x.kind === hit.kind);
      if (!g) { g = { kind: hit.kind, items: [] }; groups.push(g); }
      g.items.push(hit);
    });
    for (const g of groups) {
      out.append(h("div", { class: "sr-group", text: g.kind }));
      g.items.forEach((hit) => {
        out.append(h("button", {
          class: "sr-item", type: "button",
          onclick: () => { close(); input.value = ""; hit.onOpen(); },
        },
          h("div", { class: "sr-t", html: highlight(hit.title, needle) }),
          hit.detail ? h("div", { class: "sr-d", html: highlight(hit.detail.slice(0, 190), needle) }) : null,
        ));
      });
    }
    out.hidden = false;
  };

  input.addEventListener("input", () => render(input.value));
  input.addEventListener("focus", () => { if (input.value.length > 1) render(input.value); });
  input.addEventListener("keydown", (e) => {
    const items = out.querySelectorAll(".sr-item");
    if (e.key === "Escape") { close(); input.blur(); }
    else if (e.key === "Enter") { if (items[sel]) items[sel].click(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      items.forEach((i, n) => i.classList.toggle("sel", n === sel));
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest(".search-wrap")) close();
  });
}

/* ---------- tour ---------- */

let tourIdx = 0;

function paintTour() {
  const tourSteps = getTour();
  const s = tourSteps[tourIdx];
  if (!s) return;
  document.getElementById("tour-step").textContent = `Step ${tourIdx + 1} of ${tourSteps.length}`;
  document.getElementById("tour-title").textContent = s.title;
  document.getElementById("tour-text").innerHTML = s.text;
  document.getElementById("tour-prev").disabled = tourIdx === 0;
  document.getElementById("tour-next").textContent = tourIdx === tourSteps.length - 1 ? "Finish" : "Next";
  const dots = document.getElementById("tour-dots");
  dots.innerHTML = "";
  tourSteps.forEach((_, i) => dots.append(h("div", { class: "tour-dot" + (i === tourIdx ? " on" : "") })));
}

function initTour() {
  const t = document.getElementById("tour");
  const btn = document.getElementById("tour-btn");
  if (!t) return;
  if (btn) btn.addEventListener("click", () => { tourIdx = 0; t.hidden = false; paintTour(); });
  document.getElementById("tour-next").addEventListener("click", () => {
    const steps = getTour();
    if (tourIdx < steps.length - 1) { tourIdx++; paintTour(); }
    else t.hidden = true;
  });
  document.getElementById("tour-prev").addEventListener("click", () => { if (tourIdx > 0) { tourIdx--; paintTour(); } });
  document.getElementById("tour-skip").addEventListener("click", () => { t.hidden = true; });
  t.addEventListener("click", (e) => { if (e.target.id === "tour") t.hidden = true; });
}

/* ---------- cross-reference links ---------- */

/* Every .xref[data-view] span produced by linkify() is clickable anywhere in
   the document — main view, drawer, or search results. */
function initXrefs() {
  installXrefClicks(document.body);
}

/* ---------- boot ---------- */

function boot() {
  const sub = document.getElementById("brand-sub");
  if (sub) sub.textContent = META.subtitle;

  registerViews();
  buildSearchIndex();
  initSearch();
  initTour();
  initXrefs();

  const closeBtn = document.getElementById("drawer-close");
  if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
  const scrim = document.getElementById("scrim");
  if (scrim) scrim.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (e.key === "/" && !typing) {
      e.preventDefault();
      const s = document.getElementById("search");
      if (s) s.focus();
    }
    if (e.key === "Escape") { closeDrawer(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    /* j / k and arrow keys walk the tab strip */
    if (e.key === "j" || e.key === "k" || e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const tabs = getTabs();
      const i = tabs.findIndex((t) => t.id === currentTab());
      if (i < 0) return;
      const fwd = e.key === "j" || e.key === "ArrowRight";
      const next = tabs[(i + (fwd ? 1 : tabs.length - 1)) % tabs.length];
      if (next) { e.preventDefault(); go(next.id); }
      return;
    }
    /* ? reopens the guided tour */
    if (e.key === "?") {
      e.preventDefault();
      const t = document.getElementById("tour");
      if (t) { tourIdx = 0; t.hidden = false; paintTour(); }
    }
  });

  const hash = location.hash.replace("#", "");
  go(getTabs().some((t) => t.id === hash) ? hash : getTabs()[0].id);

  const b = document.getElementById("boot");
  if (b) {
    setTimeout(() => b.classList.add("gone"), 240);
    setTimeout(() => b.remove(), 900);
  }
}

boot();
