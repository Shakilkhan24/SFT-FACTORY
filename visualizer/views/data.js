/* ============================================================
   VIEWS — Data model (schema, roles, capabilities), packages
   ============================================================ */

import { h } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, tag, tags, callout, table, accordion, kv } from "./ui.js";

const { TABLES, DB_ROLES, CAPABILITIES, ABSENT_CAPABILITIES, API, INTEGRATIONS, DEFERRED_INTEGRATIONS, PACKAGES, APPS, TEST_SUITES, REVIEWS, DEFERRED_TECH, MUST_NOT_BUILD } = DATA.BP;

export function renderData() {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The data model",
    "Twenty-one tables, six roles, twenty capabilities",
    "The state the control plane holds, and — just as importantly — the capabilities it does not. The set of absent capabilities is as load-bearing as the set of present ones."
  ));

  /* --- tables --- */
  const tblCard = card({ title: "Tables", sub: `${TABLES.length} — authoritative state, event log, and projections` });
  tblCard.append(table(["Table", "Shape", "Role"], TABLES.map((t) => ({
    cells: [h("span", { class: "mono", style: { color: "var(--accent)" }, text: t.n }), h("span", { class: "mono", style: { fontSize: "11.4px" }, text: t.d }), t.role],
  }))));
  tblCard.append(h("div", { style: { marginTop: "13px" } },
    callout("<b>One relational store, one event log.</b> ADR-0008 puts authoritative state and the append-only event log in the same database, which makes exactly-once transitions and audit properties of the store rather than of application code. Object storage holds artefacts; there is no vector DB at the core.")));
  page.append(h("div", { class: "fade-in" }, tblCard));

  /* --- db roles --- */
  const roleCard = card({ title: "Database roles", sub: `${DB_ROLES.length} — the privilege boundary, in SQL` });
  roleCard.append(table(["Role", "Definition"], DB_ROLES.map((r) => ({
    cells: [h("span", { class: "mono", style: { color: "var(--accent)" }, text: r.n }), h("span", { class: "mono", style: { fontSize: "11.6px" }, text: r.d })],
  }))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, roleCard));

  /* --- capabilities --- */
  const capCard = card({ title: "Capabilities", sub: `${CAPABILITIES.length} — every effect the factory can have` });
  capCard.append(table(["Capability", "Kind", "Effect", "Transport", "Scope", "Used by"], CAPABILITIES.map((c) => ({
    cells: [
      h("span", { class: "mono", style: { color: "var(--accent)" }, text: c.id }),
      h("span", { class: "tag", text: c.kind }),
      h("span", { class: "tag " + (c.eff === "E0" ? "g" : c.eff === "E2" ? "w" : "b"), text: c.eff }),
      h("span", { class: "mono", style: { fontSize: "11.2px" }, text: c.tr }),
      h("span", { class: "mono", style: { fontSize: "11.2px" }, text: c.scope }),
      c.used,
    ],
  }))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, capCard));

  /* --- absent capabilities --- */
  const absCard = card({ title: "Capabilities that do not exist", sub: `${ABSENT_CAPABILITIES.length} — asserted by a test` });
  absCard.append(h("div", { class: "tags" }, ...ABSENT_CAPABILITIES.map((a) => h("span", { class: "tag b", text: a }))));
  absCard.append(h("div", { style: { marginTop: "13px" } },
    callout("<b>I-7 says no production write occurs outside an enumerated runbook. In v1 the enforcement is stronger than that:</b> there is <i>no production capability at all</i>, and a test asserts that none is registered. The absence is the mechanism. <code>factory.write</code> is never granted, and <code>secret.read</code> is never granted either — the broker mints and injects, and nothing reads a secret directly.",
      "good")));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, absCard));

  /* --- api --- */
  const apiCard = card({ title: "The control plane's API", sub: `${API.length} endpoints — the typed surface` });
  apiCard.append(table(["Access point", "Method", "Path", "Behaviour"], API.map((a) => ({
    cells: [
      h("span", { class: "tag a", text: a.ap }),
      h("span", { class: "mono", style: { color: "var(--accent-2)" }, text: a.m }),
      h("span", { class: "mono", style: { fontSize: "11.8px" }, text: a.p }),
      a.d,
    ],
  }))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, apiCard));

  return page;
}

export function renderIntegrations() {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Integrations & the codebase",
    "What talks to what, and what the repo looks like",
    "Fifteen integrations, each with its own auth model and its own failure behaviour. The failure column matters most: an integration that fails must degrade predictably, not silently."
  ));

  const intCard = card({ title: "Integrations", sub: `${INTEGRATIONS.length}` });
  intCard.append(accordion(INTEGRATIONS.map((i) => ({
    id: i.id,
    title: i.n,
    count: i.dir,
    body: () => h("div", {},
      kv([
        ["Direction", i.dir],
        ["Used for", i.used],
        ["Auth", i.auth],
        ["Capabilities", i.caps],
        ["On failure", i.fails],
      ])),
  }))));
  page.append(h("div", { class: "fade-in" }, intCard));

  /* deferred integrations */
  const defCard = card({ title: "Deferred integrations", sub: `${DEFERRED_INTEGRATIONS.length} — deliberately not built` });
  defCard.append(h("ul", { class: "list cross" }, ...DEFERRED_INTEGRATIONS.map((d) =>
    h("li", {}, h("span", { class: "dot" }), h("span", { text: typeof d === "string" ? d : d.t || d.n || JSON.stringify(d) })))));
  defCard.append(h("div", { style: { marginTop: "12px" } },
    callout("<b>Deferred is a decision, not a gap.</b> Each of these has a named trigger — the measurable condition that would justify building it. That is how a factory avoids growing a dependency surface nobody chose.")));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, defCard));

  /* packages + apps */
  const pkgCard = card({ title: "Packages", sub: "the interface boundary" });
  const pkgGrid = h("div", { class: "grid g2" });
  (PACKAGES || []).forEach((g) => {
    pkgGrid.append(h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: g.g }),
      h("div", { class: "tags", style: { marginTop: "8px" } }, ...g.list.map((p) => h("span", { class: "tag v", text: p })))));
  });
  pkgCard.append(pkgGrid);
  pkgCard.append(h("div", { style: { marginTop: "13px" } },
    callout("<b>I-12: every component is replaceable without changing the definition, workflows, agent contracts, or the event schema.</b> Each package has an in-memory fake used in tests — and that fake doubles as the proof. The packages exist to make the interface boundary real, not to be tidy.")));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, pkgCard));

  const appCard = card({ title: "Applications", sub: `${APPS.length} deployable processes` });
  appCard.append(table(["App", "What it is"], APPS.map((a) => ({
    cells: [h("span", { class: "mono", style: { color: "var(--accent)" }, text: a.n }), a.d],
  }))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, appCard));

  /* test suites + reviews */
  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } },
    card({ title: "Test suites", sub: `${TEST_SUITES.length}` },
      table(["Suite", "Priority", "What it holds"], TEST_SUITES.map((t) => ({
        cells: [h("b", { text: t.n }), h("span", { class: "tag " + (t.p === 0 ? "b" : t.p === 1 ? "w" : "g"), text: "P" + t.p }), t.d],
      })))),
    card({ title: "Reviews", sub: `${REVIEWS.length} — who signs off on what" `.slice(0, -2) },
      table(["Review", "When", "Who"], REVIEWS.map((r) => ({
        cells: [h("b", { text: r.n }), r.c, r.a],
      }))))
  ));

  /* deferred tech + must not build */
  const dtCard = card({ title: "Deferred technology", sub: "each with the trigger that would justify it" });
  dtCard.append(table(["Technology", "Phase", "Trigger"], DEFERRED_TECH.map((d) => ({
    cells: [h("b", { text: d.t }), h("span", { class: "tag", text: d.phase }), d.trigger],
  }))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, dtCard));

  const mbCard = card({ title: "Must not build", sub: "the anti-scope list — nine things that would be wrong" });
  mbCard.append(h("ul", { class: "list cross" }, ...MUST_NOT_BUILD.map((m) =>
    h("li", {}, h("span", { class: "dot" }), h("span", { text: typeof m === "string" ? m : m.t || m.name || JSON.stringify(m) })))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, mbCard));

  return page;
}
