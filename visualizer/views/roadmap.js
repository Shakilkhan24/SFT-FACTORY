/* ============================================================
   VIEW — Roadmap, tickets, gates, PRD
   ============================================================ */

import { h, esc } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, tag, callout, table, accordion, drawerRecord, kv } from "./ui.js";
import { linkify } from "./refs.js";

const { EPICS, TICKETS, SPIKES, PEAK_STUBS, GATES, PRD } = DATA;
const { WEEK_PLAN, BP_PHASES, PEAK_PHASES, MUST_NOT_BUILD, NEVER_CUT, CUT_ORDER, COMPRESSION_LEVERS, ADR_CRITICAL } = DATA.BP;

export function renderRoadmap(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The implementation plan",
    "Eight weeks from blank repo to a verified pull request",
    "The plan is deliberately narrow: one owner, one repo, one workflow first. Everything after that is configuration. Each week has an exit condition, and each phase has a gate that a human signs off."
  ));

  /* --- epic summary --- */
  const egrid = h("div", { class: "grid g4" });
  EPICS.forEach((e) => {
    const n = TICKETS.filter((t) => t.epic === e.id).length;
    const c = h("div", { class: "card pad-sm" },
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
        h("span", { class: "epic-chip" }, h("span", { class: "eid", text: e.id }), e.name)),
      h("div", { class: "stat-row", style: { marginTop: "10px" } },
        h("span", { class: "big-num", text: String(n) }),
        h("span", { class: "stat-lbl", text: "tickets" })),
      h("div", { style: { fontSize: "12px", color: "var(--ink-3)", marginTop: "7px" }, text: `${e.weeks}${e.gate !== "—" ? " · gate " + e.gate : ""}` }),
    );
    egrid.append(c);
  });
  page.append(egrid);

  /* --- week timeline --- */
  const tl = h("div", { class: "tl" });
  WEEK_PLAN.forEach((w, i) => {
    const wk = h("div", { class: "tl-week" + (w.gate ? " has-gate" : "") });
    wk.append(h("div", { class: "tl-badge", text: w.wk }));
    const c = h("div", { class: "tl-card" });
    c.append(
      h("div", { class: "tl-theme", text: w.theme }),
      h("div", { class: "tl-tickets", text: w.tickets }),
      h("div", { class: "tl-exit" }, h("b", { text: "Exit: " }), w.exit),
      w.gate ? h("div", { style: { marginTop: "9px" } }, tag("gate " + w.gate, "h")) : null,
    );
    wk.append(c);
    tl.append(wk);
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "20px" } },
    card({ title: "Week by week", sub: "W0 → W8" }, tl)));

  /* --- blueprint phases --- */
  const ph = h("div", { class: "grid g3" });
  BP_PHASES.forEach((p) => {
    ph.append(h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: p.n }),
      h("div", { style: { fontSize: "15px", fontWeight: "640", margin: "3px 0 8px" }, text: p.name }),
      h("div", { style: { fontSize: "12.9px", color: "var(--ink-2)" }, text: p.exit })));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The six blueprint phases", sub: "each has a falsifiable exit condition" }, ph)));

  /* --- peak automation phases --- */
  const pp = h("div", { class: "grid g3" });
  PEAK_PHASES.forEach((p) => {
    pp.append(h("div", { class: "card pad-sm" },
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, tag(p.id, "h"), tag(p.win, "w")),
      h("div", { style: { fontSize: "15px", fontWeight: "640", margin: "7px 0 6px" }, text: p.name }),
      h("div", { style: { fontSize: "12.8px", color: "var(--ink-2)", marginBottom: "8px" }, text: p.builds }),
      h("div", { style: { fontSize: "12.6px", color: "var(--ink-3)" }, html: "<b style='color:var(--good)'>Exit:</b> " + esc(p.exit) }),
      h("div", { style: { marginTop: "8px" } }, tag("autonomy: " + p.auto, "v"))));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The path to peak automation", sub: "A2 — five more phases after the eight weeks" },
      pp,
      h("div", { style: { marginTop: "14px" } },
        callout("<b>The unit of promotion is never the factory.</b> It is a (workflow, repo, tier band) triple. A workflow earns L3 for one repository at R0–R1; that promotion does not travel. Global promotion is exactly the kind of claim the blueprint refuses to make.")))));

  /* --- tickets explorer --- */
  const ticketCard = card({ title: "Ticket explorer", sub: `${TICKETS.length} tickets + ${SPIKES.length} spikes + ${PEAK_STUBS.length} peak stubs` });
  const filterBar = h("div", { class: "filter-bar" });
  const search = h("input", { type: "search", placeholder: "Filter tickets…" });
  const epicSel = h("select", { class: "chip", style: { padding: "4.5px 11px" } },
    h("option", { value: "", text: "All epics" }),
    ...EPICS.map((e) => h("option", { value: e.id, text: `${e.id} — ${e.name}` })));
  const wkSel = h("select", { class: "chip", style: { padding: "4.5px 11px" } },
    h("option", { value: "", text: "All weeks" }),
    ...WEEK_PLAN.map((w) => h("option", { value: w.wk, text: w.wk })));
  const note = h("span", { class: "filter-note" });
  filterBar.append(search, epicSel, wkSel, note);

  const rowsWrap = h("div", {});
  function renderRows() {
    const q = search.value.toLowerCase();
    const eF = epicSel.value, wF = wkSel.value;
    const list = TICKETS.filter((t) =>
      (!eF || t.epic === eF) && (!wF || t.wk === wF) &&
      (!q || (t.id + " " + t.title + " " + t.detail).toLowerCase().includes(q)));
    note.textContent = `${list.length} of ${TICKETS.length} tickets`;
    rowsWrap.innerHTML = "";
    if (!list.length) { rowsWrap.append(h("div", { class: "sr-empty", text: "No tickets match." })); return; }
    rowsWrap.append(table(
      ["ID", "Epic", "Wk", "Size", "Tier", "Title"],
      list.map((t) => ({
        fid: t.id,
        cells: [
          h("span", { class: "id", text: t.id }),
          t.epic, t.wk, t.size,
          h("span", { class: "tag " + (t.tier === "human" ? "w" : t.tier.startsWith("R") ? "a" : ""), text: t.tier }),
          h("span", { html: `<b>${esc(t.title)}</b>` }),
        ],
      }))
    ));
    rowsWrap.querySelectorAll("tbody tr").forEach((tr, i) => {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => openTicket(list[i]));
    });
  }
  search.addEventListener("input", renderRows);
  epicSel.addEventListener("change", renderRows);
  wkSel.addEventListener("change", renderRows);
  ticketCard.append(filterBar, rowsWrap);
  renderRows();
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, ticketCard));

  /* --- spikes + peak stubs --- */
  const sp = card({ title: "Spikes", sub: "time-boxed unknowns, resolved before they become tickets" },
    table(["ID", "The question", "Precedes", "What confirms it"], SPIKES.map((s) => ({
      fid: s.id,
      cells: [h("span", { class: "id", text: s.id }), h("b", { text: s.q }), h("span", { class: "mono", style: { fontSize: "11.4px" }, html: linkify(String(s.precedes || "")) }), s.confirm],
    }))));
  const pk = card({ title: "Peak-automation stubs", sub: "the A2 backlog, sketched" },
    table(["ID", "Epic", "Title", "Done when"], PEAK_STUBS.map((s) => ({
      fid: s.id,
      cells: [h("span", { class: "id", text: s.id }), s.e || "", h("b", { text: s.title || "" }), s.done || ""],
    }))));
  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } }, sp, pk));

  /* --- gates --- */
  const gateCard = card({ title: "Gates", sub: "the checklist that must be green before each phase exits" });
  gateCard.append(accordion(GATES.map((g) => ({
    id: g.id,
    fid: g.id,
    title: g.name + " — " + g.when,
    count: `${g.rowsList.length} rows · ${g.locked} locked`,
    body: () => {
      const wrap = h("div", {});
      wrap.append(h("div", { style: { fontSize: "12.6px", color: "var(--ink-3)", marginBottom: "10px" },
        html: g.blueprint ? `Blueprint items: <span class="mono">${esc(g.blueprint)}</span>` : "" }));
      wrap.append(table(["ID", "Checklist item", "Owner", ""], g.rowsList.map((r) => ({
        fid: r.id,
        cells: [
          h("span", { class: "id", text: r.id }),
          h("span", { html: `<b>${esc(r.t)}</b>` }),
          h("span", { class: "tag", text: r.by }),
          r.lock ? h("span", { class: "tag lock", text: "never waive" }) : "",
        ],
      }))));
      wrap.append(h("div", { style: { marginTop: "10px" } },
        callout("<b>Locked rows are never waived.</b> These are the checks that encode the load-bearing invariants — an oracle guard, a permission audit, a secret scan, an authorisation test. Slippage removes breadth, never safety.", "warn")));
      return wrap;
    },
  }))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, gateCard));

  /* --- PRD --- */
  const prdRows = PRD.map((p) => ({
    fid: p.id,
    cells: [
      h("span", { class: "id", text: p.id }),
      h("span", { html: `<b>${esc(p.t || p.title || p.requirement || "")}</b>${p.d ? "<br>" + esc(p.d) : ""}` }),
    ],
  }));
  const prdCard = card({ title: "Production readiness", sub: "PRD-1…10" });
  prdCard.append(table(["ID", "Requirement"], prdRows));

  const cutCard = card({ title: "The cut line", sub: "what gets sacrificed when the schedule slips" });
  cutCard.append(h("div", { class: "kicker", text: "Never cut" }));
  cutCard.append(h("ul", { class: "list check", style: { marginBottom: "14px" } },
    ...NEVER_CUT.map((n) => h("li", {}, h("span", { class: "dot" }), h("span", { text: n })))));
  cutCard.append(h("div", { class: "kicker", text: "Cut in this order" }));
  cutCard.append(h("ol", { class: "list", style: { paddingLeft: "18px", listStyle: "decimal" } },
    ...CUT_ORDER.map((n) => h("li", {}, h("span", { style: { flex: "1" }, text: n })))));

  const prdGrid = h("div", { class: "grid g2", style: { marginTop: "18px" } });
  prdGrid.append(prdCard, cutCard);
  page.append(prdGrid);

  /* --- compression levers --- */
  const cl = h("div", { class: "grid g2" });
  COMPRESSION_LEVERS.forEach((l) => {
    cl.append(h("div", { class: "card pad-sm" },
      h("div", { style: { display: "flex", gap: "9px" } },
        h("span", { class: "tag v", text: String(l.n) }),
        h("div", { style: { fontSize: "14.2px", fontWeight: "620" }, text: l.t })),
      h("div", { style: { fontSize: "12.9px", color: "var(--ink-2)", marginTop: "7px" }, text: l.d })));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Compression levers", sub: "how the eight weeks fit" }, cl)));

  /* --- must not build --- */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Must not build", sub: "the anti-scope list" },
      h("ul", { class: "list cross" }, ...MUST_NOT_BUILD.map((m) =>
        h("li", {}, h("span", { class: "dot" }), h("span", { text: typeof m === "string" ? m : m.t || m.name || JSON.stringify(m) })))))));

  return page;
}

function openTicket(t) {
  drawerRecord(`Ticket ${t.id}`, t.title, [
    { p: t.detail },
    { kv: [["Epic", t.epic], ["Week", t.wk], ["Size", t.size], ["Risk tier", t.tier]] },
    { h: "Why it exists", p: "Every ticket in the backlog exists because something else depends on it, or because a gate row requires it. If you cannot name the dependency, it is probably scope creep." },
  ]);
}
