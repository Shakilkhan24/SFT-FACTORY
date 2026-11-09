/* ============================================================
   VIEW — Traceability: how the pieces connect
   Invariant → proof test → red-team attack → ADR → gate row → ticket
   ============================================================ */

import { h } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, tag, callout, table, prose } from "./ui.js";
import { linkify, resolve } from "./refs.js";
import { CX_INVARIANTS } from "../data/07-context.js";
import { QE_INVARIANTS } from "../data/09-quality.js";

const { INVARIANTS, ATTACKS, GATES, TICKETS, AGENTS, WORKFLOWS } = DATA;
const { ADRS, DECISIONS } = DATA.BP;

/* Every ID mentioned anywhere in the corpus, with where it lives. */
const LOCATIONS = new Map();
function note(id, view, label, kind) {
  if (!id) return;
  if (!LOCATIONS.has(id)) LOCATIONS.set(id, []);
  LOCATIONS.get(id).push({ view, label, kind });
}

INVARIANTS.forEach((i) => note(i.id, "guarantees", i.t, "Invariant"));
ATTACKS.forEach((a) => note(a.id, "guarantees", a.name, "Attack"));
(ADRS || []).forEach((a) => note(a.n, "decisions", a.title, "ADR"));
(DECISIONS || []).forEach((d) => note(d.id, "decisions", d.q, "Decision"));
(DATA.INV_TESTS || []).forEach((t) => note(t.id, "coverage", t.t, "Invariant test"));
(DATA.COVERAGE || []).forEach((c) => note(c.id, "coverage", c.n || "", "Requirement"));
TICKETS.forEach((t) => note(t.id, "roadmap", t.title, "Ticket"));
GATES.forEach((g) => note(g.id, "roadmap", g.name, "Gate"));
GATES.forEach((g) => g.rowsList.forEach((r) => note(r.id, "roadmap", r.t, "Checklist row")));
AGENTS.forEach((a) => note(a.id, "agents", a.name, "Agent"));
CX_INVARIANTS.forEach((c) => note(c.id, "context", c.t, "Context invariant"));
QE_INVARIANTS.forEach((q) => note(q.id, "quality", q.t, "Quality invariant"));

/* Pull every ID out of a body of text. */
const ID_RE = /\b(ADR-\d{4}|INV-\d{1,2}|FR-\d{1,3}|SEC-\d{1,2}|I-\d{1,2}|AT-\d{1,2}|T-\d+\.\d{2}|S-\d+|RP-\d+|R-\d{2}|Q-\d{2}|H-\d{2}|D\d{1,2}|AP-\d|PRD-\d+)\b/g;
function idsIn(text) {
  const s = String(text || "");
  const out = [];
  let m;
  ID_RE.lastIndex = 0;
  while ((m = ID_RE.exec(s)) !== null) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

/* Build the reference graph: for each known ID, which other IDs it mentions. */
const GRAPH = new Map();
function scan(id, ...texts) {
  const refs = new Set();
  texts.forEach((t) => idsIn(t).forEach((x) => { if (x !== id) refs.add(x); }));
  GRAPH.set(id, [...refs]);
}

INVARIANTS.forEach((i) => scan(i.id, i.t, i.enforced, i.proof));
ATTACKS.forEach((a) => scan(a.id, a.name, a.desc, a.defence));
(ADRS || []).forEach((a) => scan(a.n, a.title, a.decision, a.consequence, a.hard));
(DECISIONS || []).forEach((d) => scan(d.id, d.q, d.def, d.blocks));
(DATA.INV_TESTS || []).forEach((t) => scan(t.id, t.t));
TICKETS.forEach((t) => scan(t.id, t.title, t.detail));
GATES.forEach((g) => {
  scan(g.id, g.name, g.when, g.blueprint);
  g.rowsList.forEach((r) => scan(r.id, r.t));
});
(DATA.COVERAGE || []).forEach((c) => scan(c.id, c.n, c.tk));
(DATA.BP.QUESTIONS || []).forEach((q) => scan(q.id, q.q, q.why, q.handle));
(DATA.BP.HYPOTHESES || []).forEach((x) => scan(x.id, x.t, x.why, x.test));
CX_INVARIANTS.forEach((c) => scan(c.id, c.t, c.enf));
QE_INVARIANTS.forEach((q) => scan(q.id, q.t, q.enf));

/* Rank records by how many other records they touch. */
const RANKED = [...GRAPH.entries()]
  .map(([id, refs]) => ({ id, refs, n: refs.length }))
  .filter((r) => r.n > 0)
  .sort((a, b) => b.n - a.n);

export function renderTrace(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Traceability",
    "How one record connects to the next",
    "Every guarantee in this blueprint is supposed to be enforced by a mechanism, proved by a test, defended against a named attack, decided by an ADR, checked by a gate row and built by a ticket. This page draws those chains — and shows you where a chain is broken."
  ));

  /* ---- stats ---- */
  const withRefs = RANKED.length;
  const totalRefs = RANKED.reduce((s, r) => s + r.n, 0);
  const orphaned = [...GRAPH.keys()].filter((id) => !GRAPH.get(id).length && !refsTo(id));

  const grid = h("div", { class: "grid g4" });
  [
    ["Records tracked", String(GRAPH.size), "with an identifier"],
    ["Records that reference others", String(withRefs), "cross-linked"],
    ["Cross-references total", String(totalRefs), "directed edges"],
    ["Isolated records", String(orphaned.length), "mention nothing else"],
  ].forEach(([k, v, s]) => {
    grid.append(h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: k }),
      h("div", { class: "stat-row", style: { marginTop: "6px" } },
        h("span", { class: "big-num", text: v }),
        h("span", { class: "stat-lbl", text: s }))));
  });
  page.append(grid);

  page.append(h("div", { style: { marginTop: "16px" } },
    callout("<b>Read a chain like this:</b> an invariant names the test that proves it (INV-1), the attack it defends against (AT-5), the ADR that decided it (ADR-0004), the gate row that checks it (CL-G1-xx) and the ticket that builds it (T-2.xx). A guarantee with no test is an aspiration; a test with no ticket is never written. Click any ID to jump to it.")));

  /* ---- the chain explorer ---- */
  const picker = h("div", { class: "filter-bar" });
  const sel = h("select", { class: "fsel" });
  const GROUPS = [
    ["Invariants", INVARIANTS.map((i) => i.id)],
    ["Red-team attacks", ATTACKS.map((a) => a.id)],
    ["ADRs", (ADRS || []).map((a) => a.n)],
    ["Owner decisions", (DECISIONS || []).map((d) => d.id)],
    ["Invariant tests", (DATA.INV_TESTS || []).map((t) => t.id)],
    ["Requirements", (DATA.COVERAGE || []).map((c) => c.id)],
    ["Context invariants", CX_INVARIANTS.map((c) => c.id)],
    ["Quality invariants", QE_INVARIANTS.map((q) => q.id)],
    ["Gates", GATES.map((g) => g.id)],
    ["Tickets", TICKETS.map((t) => t.id)],
  ];
  GROUPS.forEach(([label, ids]) => {
    if (!ids.length) return;
    const og = h("optgroup", { label });
    ids.forEach((id) => og.append(h("option", { value: id, text: id })));
    sel.append(og);
  });
  picker.append(sel);

  const out = h("div", {});
  const paint = () => {
    const id = sel.value;
    out.innerHTML = "";
    out.append(chainView(id));
  };
  sel.addEventListener("change", paint);
  picker.append(out);
  if (!sel.value && sel.children.length) sel.value = sel.children[0].value;
  paint();
  page.append(h("div", { class: "fade-in", style: { marginTop: "20px" } },
    card({ title: "Follow a chain", sub: "pick a record and see everything it touches" }, picker)));

  /* ---- most connected ---- */
  const top = RANKED.slice(0, 14);
  const topCard = card({ title: "The most connected records", sub: "these are the load-bearing hubs" });
  topCard.append(table(
    ["Record", "Kind", "Touches", "What it links to"],
    top.map((r) => {
      const loc = LOCATIONS.get(r.id);
      const kind = loc && loc[0] ? loc[0].kind : "—";
      const label = loc && loc[0] ? loc[0].label : "";
      return {
        fid: r.id,
        cells: [
          h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "600" }, text: r.id }),
          h("span", { class: "tag", text: kind }),
          h("span", { class: "mono", text: String(r.n) }),
          h("span", { style: { fontSize: "12.4px", color: "var(--ink-3)" }, html: linkify(r.refs.slice(0, 8).join(" · ")) }),
        ],
      };
    })
  ));
  topCard.append(h("div", { style: { marginTop: "13px" } },
    callout("<b>The hubs are the commitments, not the components.</b> The records that touch the most others are the invariants, the ADRs and the owner decisions — the things that constrain many parts. The components touch few, which is the point: they are replaceable (I-12).")));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, topCard));

  return page;
}

/* Which records point AT this one? */
function refsTo(id) {
  const out = [];
  GRAPH.forEach((refs, from) => { if (refs.includes(id)) out.push(from); });
  return out;
}

/* Build the chain panel for one record. */
function chainView(id) {
  const wrap = h("div", {});
  const loc = LOCATIONS.get(id);
  const outbound = GRAPH.get(id) || [];
  const inbound = refsTo(id);

  const title = h("div", { class: "chain-head" },
    h("span", { class: "mono chain-id", text: id }),
    loc && loc[0] ? h("span", { class: "tag", text: loc[0].kind }) : null,
  );
  wrap.append(title);
  if (loc && loc[0] && loc[0].label) {
    wrap.append(h("div", { class: "chain-label", text: loc[0].label }));
  }

  /* outbound: this record → others */
  wrap.append(h("div", { class: "chain-sec" },
    h("div", { class: "chain-sec-k", text: `References out (${outbound.length})` })));
  const ob = h("div", { class: "chain-row" });
  if (!outbound.length) {
    ob.append(h("span", { class: "chain-empty", text: "nothing — this record is a leaf" }));
  } else {
    outbound.forEach((r) => {
      const res = resolve(r);
      const l = LOCATIONS.get(r);
      ob.append(h("button", {
        class: "chain-chip" + (l ? "" : " unknown"),
        type: "button",
        title: l ? `${l[0].kind}: ${l[0].label}` : "referenced but not present in the data model",
        onclick: () => { if (res) navigateTo(res); },
      }, r));
    });
  }
  wrap.append(ob);

  /* inbound: others → this record */
  wrap.append(h("div", { class: "chain-sec" },
    h("div", { class: "chain-sec-k", text: `Referenced by (${inbound.length})` })));
  const ib = h("div", { class: "chain-row" });
  if (!inbound.length) {
    ib.append(h("span", { class: "chain-empty", text: "nothing points here" }));
  } else {
    inbound.forEach((r) => {
      const res = resolve(r);
      const l = LOCATIONS.get(r);
      ib.append(h("button", {
        class: "chain-chip" + (l ? "" : " unknown"),
        type: "button",
        title: l ? `${l[0].kind}: ${l[0].label}` : "referenced but not present in the data model",
        onclick: () => { if (res) navigateTo(res); },
      }, r));
    });
  }
  wrap.append(ib);

  /* dangling references — IDs that appear in prose but have no record */
  const dangling = [...outbound, ...inbound].filter((r) => !LOCATIONS.has(r));
  if (dangling.length) {
    wrap.append(h("div", { class: "chain-sec" },
      h("div", { class: "chain-sec-k", text: `Referenced but not modelled (${dangling.length})` })));
    wrap.append(h("div", { class: "chain-row" },
      ...dangling.map((d) => h("span", { class: "chain-chip unknown", text: d }))));
    wrap.append(h("div", { class: "chain-note", text: "These IDs appear in the prose but have no record in the visualizer. They are usually blueprint deliverables (A-n) or coverage IDs, not missing data." }));
  }

  return wrap;
}

function navigateTo(res) {
  /* imported lazily to avoid a circular import at module load */
  import("../router.js").then((m) => m.navigate(res.view, res.params));
}
