/* ============================================================
   VIEW — Coverage: requirement matrix, invariant tests,
          deferral register, Friday checkpoint
   ============================================================ */

import { h } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, tag, callout, table, accordion, drawerRecord, kv } from "./ui.js";

const { COVERAGE, COVERAGE_STATUS, INV_TESTS, DEFERRALS, FRIDAY, TICKETS, GATES, INVARIANTS } = DATA;

const STATUS_ORDER = ["y", "p", "d", "a"];

export function renderCoverage(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Coverage & registers",
    "What is proved, what is partial, what is deliberately not built",
    "Three documents that tell you where the blueprint actually stands. The requirement matrix says which of the blueprint's requirements are covered in v1 and by which tickets. The invariant inventory says which gate must prove each safety property. The deferral register says what was cut and the measurable trigger that would bring it back."
  ));

  /* ---------- status summary ---------- */
  const counts = {};
  STATUS_ORDER.forEach((s) => { counts[s] = COVERAGE.filter((c) => c.s === s).length; });
  const total = COVERAGE.length;

  const sum = h("div", { class: "grid g4" });
  STATUS_ORDER.forEach((s) => {
    const st = COVERAGE_STATUS[s];
    const pct = Math.round((counts[s] / total) * 100);
    const c = h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: st.label }),
      h("div", { class: "stat-row", style: { marginTop: "6px" } },
        h("span", { class: "big-num", text: String(counts[s]) }),
        h("span", { class: "stat-lbl", text: pct + "%" })),
      h("div", { style: { marginTop: "9px", height: "4px", borderRadius: "3px", background: "rgba(255,255,255,.06)", overflow: "hidden" } },
        h("div", { style: { width: pct + "%", height: "100%", borderRadius: "3px", background: "var(--" + ({ g: "good", w: "warn", b: "bad", v: "accent-2" })[st.cls] + ")" } })),
    );
    sum.append(c);
  });
  page.append(sum);

  page.append(h("div", { style: { marginTop: "16px" } },
    callout("<b>" + total + " tracked requirements</b> across functional (FR) and security (SEC) families. Everything marked covered is claimed by a specific ticket — follow the link and you land on the work that implements it. Partial and deferred entries carry the reason inline, so nothing is quietly dropped.", "good")));

  /* ---------- requirement matrix ---------- */
  const matrixCard = card({
    title: "Requirement coverage matrix",
    sub: `${total} requirements · click a row for the detail`,
  });

  /* filter bar */
  const bar = h("div", { class: "filter-bar", style: { marginBottom: "12px" } });
  let active = "all";

  /* the table() helper takes HTML strings, so this table is built by hand */
  const buildTable = () => {
    const t = h("table", { class: "tbl" });
    t.append(h("thead", {}, h("tr", {},
      h("th", { text: "Req" }), h("th", { text: "Status" }),
      h("th", { text: "Proved by" }), h("th", { text: "Note" }))));
    const tb = h("tbody", {});
    const rows = COVERAGE.filter((c) => active === "all" || c.s === active);
    if (!rows.length) {
      tb.append(h("tr", {}, h("td", { colspan: "4", style: { color: "var(--ink-3)", padding: "18px" }, text: "No requirements in this state." })));
    }
    rows.forEach((c) => {
      const st = COVERAGE_STATUS[c.s];
      const tr = h("tr", { class: "frec", "data-fid": c.id, style: { cursor: "pointer" } });
      tr.append(
        h("td", {}, h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "600" }, text: c.id })),
        h("td", {}, tag(st.label, st.cls)),
        h("td", {}, h("span", { class: "mono", style: { fontSize: "11.6px" }, text: c.tk })),
        h("td", { style: { fontSize: "12.4px", color: "var(--ink-3)" }, text: c.n || "—" }),
      );
      tr.addEventListener("click", () => openReq(c));
      tb.append(tr);
    });
    t.append(tb);
    return h("div", { class: "tbl-scroll", style: { maxHeight: "620px" } }, t);
  };

  const holder = h("div", {});
  const paint = () => { holder.innerHTML = ""; holder.append(buildTable()); };

  const mkFilter = (key, label, cls) => {
    const b = h("button", {
      class: "fbtn" + (active === key ? " on" : ""),
      type: "button",
      onclick: () => {
        active = key;
        bar.querySelectorAll(".fbtn").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        paint();
      },
    }, label);
    return b;
  };

  bar.append(mkFilter("all", `All ${total}`, ""));
  STATUS_ORDER.forEach((s) => bar.append(mkFilter(s, `${COVERAGE_STATUS[s].label} ${counts[s]}`, COVERAGE_STATUS[s].cls)));
  matrixCard.append(bar);
  matrixCard.append(holder);
  paint();
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, matrixCard));

  /* ---------- invariant test inventory ---------- */
  const invCard = card({ title: "Invariant test inventory", sub: `${INV_TESTS.length} tests — each invariant needs one` });
  invCard.append(table(
    ["Test", "Proves", "Proved at"],
    INV_TESTS.map((t) => ({
      fid: t.id,
      cells: [
        h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "600" }, text: t.id }),
        t.t,
        h("span", { class: "tag " + (t.at === "G3" ? "w" : "a"), text: t.at }),
      ],
    }))
  ));
  invCard.append(h("div", { style: { marginTop: "13px" } },
    callout("<b>The ordering is the point.</b> Seven of twelve invariants must be proved at <b>G1</b> — the Phase-0 exit, at the end of week 2 — before the factory touches real work. Only <code>INV-7</code> (no production capability) is allowed to wait for G3, because it is the one that says a thing does not exist. If a safety invariant cannot be tested at G1, it cannot be enforced at L2.")));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, invCard));

  /* ---------- deferral register ---------- */
  const defCard = card({ title: "Deferral register", sub: `${DEFERRALS.length} — every cut, with the trigger that reverses it` });
  defCard.append(accordion(DEFERRALS.map((d) => ({
    id: d.item,
    title: d.item,
    count: d.rev,
    body: () => h("div", {},
      kv([
        ["Blueprint ref", d.ref],
        ["Why deferred", d.why],
        ["Trigger to build", d.trig],
        ["Review", d.rev],
      ])),
  }))));
  defCard.append(h("div", { style: { marginTop: "13px" } },
    callout("<b>Deferred is a decision, not a gap.</b> Each line has a named, measurable trigger — the condition that would justify building it — and a review cadence. That is what stops a factory from growing a dependency surface nobody chose, and what stops a deferral from quietly becoming permanent.", "warn")));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, defCard));

  /* ---------- friday checkpoint ---------- */
  const friCard = card({ title: "The Friday checkpoint", sub: `${FRIDAY.length} questions · 30 minutes · every week` });
  const fl = h("ol", { class: "list num" });
  FRIDAY.forEach((f) => {
    fl.append(h("li", { class: "frec", "data-fid": "fri-" + f.q.slice(0, 12) },
      h("b", { text: f.q }),
      f.a ? h("span", { style: { color: "var(--ink-2)", fontSize: "12.8px" }, text: " — " + f.a }) : null));
  });
  friCard.append(fl);
  friCard.append(h("div", { style: { marginTop: "13px" } },
    callout("<b>This is the measurement loop, in its shortest form.</b> If two weeks in a row are red, apply the next cut from the compression order and record it in the deferral register. A flaky security test is a security finding — not a flake to be retried.", "good")));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, friCard));

  return page;
}

function openReq(c) {
  const st = COVERAGE_STATUS[c.s];
  const tickets = (c.tk.match(/T-\d+\.\d+/g) || []);
  const ticketObjs = TICKETS.filter((t) => tickets.includes(t.id));
  drawerRecord(`Requirement ${c.id}`, c.id, [
    { p: c.n || "No note recorded — this requirement is fully covered as stated." },
    { kv: [["Status", st.label], ["Proved by", c.tk]] },
    ticketObjs.length
      ? { h: "Implementing tickets", list: ticketObjs.map((t) => `<b>${t.id}</b> — ${t.title}`) }
      : null,
    { h: "What this means", p: EXPLAIN[c.s] || "" },
  ].filter(Boolean));
}

const EXPLAIN = {
  y: "A ticket exists and implements this requirement. The link is the proof, and the gate is where that ticket must be green.",
  p: "Partly implemented. The note names exactly what is missing — the gap is scoped, not hidden.",
  d: "Deliberately deferred out of v1. There is a trigger in the deferral register that would bring it back.",
  a: "Satisfied by the absence of the capability. Nothing can violate a rule about something that does not exist — and a test asserts that it does not exist.",
};
