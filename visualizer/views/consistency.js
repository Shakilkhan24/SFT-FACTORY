/* ============================================================
   VIEW — Consistency: where the source documents disagree,
          and which reading this visualizer treats as true
   ============================================================ */

import { h } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, tag, callout, table, drawerRecord, kv, prose, proseSpan } from "./ui.js";

const { CONFLICTS, CONFLICT_ORDER, CONFLICT_KINDS } = DATA;

export function renderConsistency(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Consistency ledger",
    "Where the documents disagree — and which reading wins",
    "A blueprint written across two dozen documents will contain places where two documents say different things. None of these are bugs in the design; they are places where a reader can lose an afternoon. This page names each one, states both claims, and says which one the visualizer uses."
  ));

  /* ---- summary ---- */
  const kinds = {};
  CONFLICTS.forEach((c) => { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });

  const grid = h("div", { class: "grid g4" });
  grid.append(h("div", { class: "card pad-sm" },
    h("div", { class: "kicker", text: "Disagreements" }),
    h("div", { class: "stat-row", style: { marginTop: "6px" } },
      h("span", { class: "big-num", text: String(CONFLICTS.length) }),
      h("span", { class: "stat-lbl", text: "catalogued" }))));
  Object.entries(CONFLICT_KINDS).forEach(([k, v]) => {
    grid.append(h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: v.label }),
      h("div", { class: "stat-row", style: { marginTop: "6px" } },
        h("span", { class: "big-num", text: String(kinds[k] || 0) }),
        h("span", { class: "stat-lbl", text: kinds[k] ? "cases" : "none" }))));
  });
  page.append(grid);

  page.append(h("div", { style: { marginTop: "16px" } },
    callout("<b>Read this page before you read the plan.</b> Every entry here was resolved by asking which source is authoritative — the document that defines the thing, rather than the document that summarises it. Where the answer was genuinely ambiguous, the entry says so rather than pretending otherwise.")));

  /* ---- the ledger ---- */
  const ordered = CONFLICT_ORDER
    .map((id) => CONFLICTS.find((c) => c.id === id))
    .filter(Boolean);

  const list = h("div", {});
  ordered.forEach((c, i) => {
    const k = CONFLICT_KINDS[c.kind];
    const item = h("div", { class: "card frec", "data-fid": c.id, style: { marginBottom: "14px" } });

    item.append(
      h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" } },
        h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700", fontSize: "12.6px" }, text: c.id }),
        h("span", { style: { fontSize: "16px", fontWeight: "640" }, text: c.topic }),
        tag(k.label, k.cls)),
    );

    /* claim vs counter, side by side */
    const two = h("div", { class: "grid g2", style: { gap: "10px", marginTop: "10px" } });
    two.append(
      h("div", { class: "claim-box" },
        h("div", { class: "claim-kicker", text: "One document says" }),
        proseSpan(c.claim, "claim-text")),
      h("div", { class: "claim-box other" },
        h("div", { class: "claim-kicker", text: "Another says" }),
        proseSpan(c.counter, "claim-text")),
    );
    item.append(two);

    item.append(h("div", { class: "verdict", style: { marginTop: "12px" } },
      h("span", { class: "verdict-kicker", text: "This visualizer uses" }),
      h("span", { class: "verdict-val", text: c.verdict })));

    item.append(prose(c.why, "why-text"));
    item.append(h("div", { class: "impact" },
      h("b", { text: "Why it matters: " }),
      proseSpan(c.impact, "ink2")));

    item.append(h("div", { style: { marginTop: "11px" } },
      h("button", {
        class: "linkbtn",
        type: "button",
        onclick: () => openConflict(c),
      }, "Open full entry →")));

    list.append(item);
  });

  page.append(h("div", { class: "fade-in", style: { marginTop: "20px" } },
    card({ title: "The ledger", sub: `${ordered.length} entries, in the order you are most likely to hit them` }, list)));

  /* ---- quick reference table ---- */
  const refCard = card({ title: "Quick reference", sub: "the disputed numbers, at a glance" });
  refCard.append(table(
    ["Question", "Answer in this visualizer", "Where to look"],
    [
      ["How many task states?", "19", "State machine view"],
      ["How many workflows?", "Seven — A, B, C, D, E, F, G", "Workflows view"],
      ["How many agent roles?", "Twelve catalogue roles + three Workflow-G roles", "Agents view"],
      ["How many invariants?", "Twelve", "Guarantees view"],
      ["How many requirements are tracked?", "79 rows (67 FR + 12 SEC)", "Coverage view"],
      ["Is there a production capability in v1?", "No — and a test asserts it", "Data model view"],
    ].map((r) => ({
      cells: [
        h("b", { text: r[0] }),
        h("span", { style: { color: "var(--good)" }, text: r[1] }),
        h("span", { style: { fontSize: "12.4px", color: "var(--ink-3)" }, text: r[2] }),
      ],
    }))
  ));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, refCard));

  return page;
}

function openConflict(c) {
  const k = CONFLICT_KINDS[c.kind];
  drawerRecord(`Consistency ${c.id}`, c.topic, [
    { p: c.claim },
    { h: "The other reading", p: c.counter },
    { kv: [["This visualizer uses", c.verdict], ["Kind", k.label]] },
    { h: "Why", p: c.why },
    { h: "Why it matters", p: c.impact },
  ]);
}
