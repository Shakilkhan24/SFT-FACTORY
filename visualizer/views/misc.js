/* ============================================================
   VIEWS — Start page, commitments, access, algorithms, metrics, stacks
   ============================================================ */

import { h } from "../dom.js";
import { DATA } from "../data/index.js";
import { card, pageHead, tag, callout, table, drawerRecord, kv } from "./ui.js";

const { VISION, COMMITMENTS, META } = DATA;

/* ============================================================
   START — the orientation page
   ============================================================ */

export function renderStart() {
  const page = h("div", { class: "page narrow" });

  page.append(h("div", { class: "phead fade-in" },
    h("div", { class: "eyebrow", text: "Start here" }),
    h("h2", { style: { fontSize: "34px", letterSpacing: "-.03em" }, text: "The Software Factory" }),
    h("p", { class: "lede", style: { fontSize: "16.5px", maxWidth: "72ch" }, text: VISION.working }),
  ));

  /* the 1968 definition */
  const d = card({ cls: "" });
  d.append(
    h("div", { class: "kicker", text: "Where the idea comes from" }),
    h("div", { style: { fontSize: "16px", fontStyle: "italic", color: "var(--ink)", margin: "10px 0 8px", lineHeight: "1.55" }, text: "“" + VISION.definition1968 + "”" }),
    h("div", { class: "mono", style: { fontSize: "11.6px", color: "var(--ink-3)" }, text: VISION.definition1968Source }),
  );
  page.append(h("div", { class: "fade-in" }, d));

  /* three components */
  const tc = h("div", { class: "grid g3" });
  VISION.threeComponents.forEach((c, i) => {
    tc.append(h("div", { class: "card pad-sm" },
      h("div", { class: "kicker", text: "component " + (i + 1) }),
      h("div", { style: { fontSize: "14px", fontWeight: "640", margin: "5px 0 9px", color: "var(--ink-3)" }, text: c.legacy }),
      h("div", { style: { fontSize: "14.6px", fontWeight: "620", color: "var(--accent)" }, text: c.now })));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "1968's three components, today", sub: "the same three, remade" }, tc)));

  /* the two problems */
  const tp = h("div", { class: "grid g2" });
  VISION.twoProblems.forEach((p, i) => {
    tp.append(h("div", { class: "card" },
      h("div", { class: "kicker", text: "problem " + (i + 1) }),
      h("div", { style: { fontSize: "16px", fontWeight: "640", margin: "6px 0 9px" }, text: p.title }),
      h("div", { style: { fontSize: "13.4px", color: "var(--ink-2)" }, text: p.detail }),
      h("div", { class: "mono", style: { fontSize: "11.2px", color: "var(--accent-2)", marginTop: "10px" }, text: p.source })));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The two problems this blueprint exists to solve", sub: "and they are different from each other" }, tp)));

  /* commitments */
  const cm = h("div", {});
  COMMITMENTS.forEach((c) => {
    const item = h("div", { class: "card frec", "data-fid": c.id, style: { marginBottom: "14px" } });
    item.append(
      h("div", { style: { display: "flex", gap: "11px", alignItems: "baseline", flexWrap: "wrap" } },
        h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700" }, text: c.id }),
        h("div", { style: { fontSize: "17px", fontWeight: "650" }, text: c.title })),
      h("div", { style: { fontSize: "13.8px", color: "var(--ink-2)", margin: "9px 0 11px" }, text: c.detail }),
      h("div", { style: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" } },
        h("span", { class: "tag v", text: c.weight }),
        h("span", { class: "tags" }, ...c.tags.map((t) => h("span", { class: "tag", text: t })))),
    );
    cm.append(item);
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The five commitments", sub: "if you remember nothing else, remember these" }, cm)));

  /* not this */
  const nt = h("div", {});
  VISION.notThis.forEach((n) => {
    nt.append(h("div", { class: "pipe-step" },
      h("div", { class: "pipe-rail" }, h("div", { class: "pipe-dot", text: "✕" })),
      h("div", { class: "pipe-body" },
        h("div", { class: "pipe-title", text: "Not " + n.it }),
        h("div", { style: { fontSize: "13.2px", color: "var(--ink-2)", marginTop: "7px" }, text: n.why }))));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "What this is not", sub: "five false readings to avoid" }, nt)));

  /* closing */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({},
      h("div", { style: { fontSize: "19px", fontWeight: "600", lineHeight: "1.5", letterSpacing: "-.01em" }, text: VISION.closingPosition }),
      h("div", { style: { marginTop: "14px" } },
        h("div", { class: "mono", style: { fontSize: "11.4px", color: "var(--ink-3)" },
          text: `Source: ${META.source} · generated ${META.generated}` })),
      h("div", { style: { marginTop: "16px" } },
        h("button", { class: "btn primary", type: "button", onclick: () => { document.getElementById("tour").hidden = false; } }, "Take the guided tour →")))));

  return page;
}

/* ============================================================
   COMMITMENTS
   ============================================================ */

export function renderCommitments(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The five commitments",
    "The load-bearing decisions, in order of leverage",
    "C1 is the single highest-leverage decision in the entire blueprint. The rest follow from it."
  ));

  const grid = h("div", { class: "grid g2" });
  COMMITMENTS.forEach((c) => {
    const cardEl = h("div", { class: "card click frec", "data-fid": c.id, onclick: () => openCommit(c) });
    cardEl.append(
      h("div", { style: { display: "flex", gap: "10px", alignItems: "baseline" } },
        h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700", fontSize: "14px" }, text: c.id }),
        h("div", { style: { fontSize: "16.6px", fontWeight: "650", lineHeight: "1.35" }, text: c.title })),
      h("div", { style: { fontSize: "13.6px", color: "var(--ink-2)", margin: "10px 0 12px" }, text: c.detail }),
      h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
        h("span", { class: "tag v", text: c.weight }),
        h("span", { class: "tags" }, ...c.tags.map((t) => h("span", { class: "tag", text: t })))),
    );
    grid.append(cardEl);
  });
  page.append(h("div", { class: "fade-in" }, grid));

  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } },
    card({ title: "The commitment that decides the rest", sub: "C1" },
      callout("<b>The oracle comes first.</b> The acceptance criteria are expressed as a checkable oracle during specification, before any implementation stage runs — and the oracle is authored against the <i>specification</i>, not the implementation. An agent may propose extra tests. It may never write the tests that decide its own change.",
        "good")),
    card({ title: "The commitment that makes it structural", sub: "C2" },
      callout("<b>The control plane holds the state; the data plane does the work.</b> There is no path from an agent to an effect that bypasses a policy decision, <i>because no such path exists</i>. That is a topological property, not an aspiration. Any safety story that depends on the agent choosing well is not a safety story."))));

  return page;
}

function openCommit(c) {
  drawerRecord(`Commitment ${c.id}`, c.title, [
    { p: c.detail },
    { kv: [["Weight", c.weight], ["References", c.tags.join(" · ")]] },
  ]);
}

/* ============================================================
   ACCESS POINTS
   ============================================================ */

export function renderAccess(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Human access",
    "Six typed entry points and nothing else",
    "The factory's entire human interface is enumerable. That is the point: if humans could act through informal channels, the abstraction would collapse into 'humans can do anything' and every guarantee downstream would weaken."
  ));
  const { ACCESS_POINTS, CONTROL_VERBS } = DATA;

  const grid = h("div", { class: "grid g3" });
  ACCESS_POINTS.forEach((a) => {
    grid.append(h("div", { class: "card click frec", "data-fid": a.id, onclick: () => openAP(a) },
      h("div", { style: { display: "flex", gap: "9px", alignItems: "center" } },
        h("span", { class: "tag a", text: a.id }),
        h("div", { style: { fontSize: "15px", fontWeight: "640" }, text: a.verb })),
      h("div", { class: "mono", style: { fontSize: "12px", color: "var(--accent-2)", marginTop: "9px" }, text: a.body }),
      h("div", { style: { fontSize: "12.6px", color: "var(--ink-3)", marginTop: "9px" }, text: a.auth })));
  });
  page.append(h("div", { class: "fade-in" }, grid));

  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } },
    card({ title: "Control verbs", sub: "AP-5's vocabulary" },
      h("div", { class: "tags" }, ...CONTROL_VERBS.map((v) => h("span", { class: "tag a", text: v }))),
      h("div", { style: { fontSize: "12.9px", color: "var(--ink-3)", marginTop: "12px" }, text: "Plus a kill switch. Every one of these is an authorised, logged, reversible act. There is no 'make it work' verb." })),
    card({ title: "Why enumeration matters", sub: "the abstraction test" },
      callout("If the access points were not enumerable, the whole authority model would be decorative — because any human could reach any capability through an informal path. <b>AP-6 (amend the factory) accepting only a merged git SHA plus an approval ID is the sharpest test:</b> it means the factory can be changed only by the same process that changes any other code. There is no privileged path, not even for the factory itself."))
  ));

  return page;
}

function openAP(a) {
  drawerRecord(`Access point ${a.id}`, a.verb, [
    { kv: [["Endpoint", a.body], ["Authority", a.auth]] },
    { h: "Why typed", p: "An access point carries defined authority. That is what makes the control surface auditable: every human action arrives through one of six named doors, each with its own auth rule and its own event trail." },
  ]);
}

/* ============================================================
   ALGORITHMS
   ============================================================ */

export function renderAlgorithms(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The algorithms",
    "The parts that had to be built bespoke",
    "Postgres, S3, Docker and a GitHub App are off-the-shelf. These are the ones the blueprint says to build from scratch — because each one encodes an invariant."
  ));
  const { ALGORITHMS } = DATA;

  const grid = h("div", { class: "grid g2" });
  ALGORITHMS.forEach((a) => {
    grid.append(h("div", { class: "card click", onclick: () => openAlgo(a) },
      h("div", { style: { display: "flex", gap: "9px", alignItems: "center", flexWrap: "wrap" } },
        h("span", { class: "tag v", text: a.id }),
        h("div", { style: { fontSize: "15px", fontWeight: "630" }, text: a.name })),
      a.subtitle ? h("div", { class: "mono", style: { fontSize: "11.4px", color: "var(--accent-2)", marginTop: "6px" }, text: a.subtitle }) : null,
      h("div", { style: { fontSize: "12.9px", color: "var(--ink-2)", marginTop: "8px" },
        text: a.steps ? `${a.steps.length} steps` : (a.formula ? "scoring formula" : "specified in the blueprint") })));
  });
  page.append(h("div", { class: "fade-in" }, grid));

  return page;
}

function openAlgo(a) {
  const sections = [];
  if (a.subtitle) sections.push({ p: a.subtitle });
  if (a.where) sections.push({ kv: [["Lives in", a.where]] });
  if (a.steps && a.steps.length) {
    const ol = h("ol", { class: "list", style: { paddingLeft: "20px", listStyle: "decimal" } });
    a.steps.forEach((s) => ol.append(h("li", { style: { display: "list-item" } },
      h("span", { style: { flex: "1" }, text: typeof s === "string" ? s : s.t || s.step || JSON.stringify(s) }))));
    sections.push({ h: "Steps", node: ol });
  }
  if (a.dims) {
    sections.push({ h: "Dimensions", p: a.dims.join(" · ") });
  }
  if (a.tail) sections.push({ p: a.tail });
  if (a.formula) sections.push({ kv: [["Formula", a.formula]] });
  if (a.order) sections.push({ p: a.order });
  if (a.thresholds) {
    const rows = Object.entries(a.thresholds).map(([k, v]) => ({ cells: [h("span", { class: "mono", text: k }), String(v)] }));
    sections.push({ h: "Thresholds", node: table(["Metric", "Threshold"], rows) });
  }
  if (a.never) sections.push({ h: "Never", p: Array.isArray(a.never) ? a.never.join(" · ") : a.never });
  drawerRecord(`Algorithm — ${a.id}`, a.name, sections);
}

/* ============================================================
   METRICS
   ============================================================ */

export function renderMetrics() {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Measurement",
    "What the factory reports about itself",
    "The factory measures itself and reports honestly, including when unflattering. Cost is attributed to the accepted change — that is the business unit, not the token."
  ));
  const { METRICS, FOUR_REPORTS, GUARDRAILS } = DATA.BP;

  if (METRICS && METRICS.length) {
    const grid = h("div", { class: "grid g3" });
    METRICS.forEach((g) => {
      grid.append(h("div", { class: "card pad-sm" },
        h("div", { class: "kicker", text: g.g }),
        h("ul", { class: "list", style: { marginTop: "6px" } },
          ...g.m.map((m) => h("li", {}, h("span", { class: "dot" }), h("span", { text: m }))))));
    });
    page.append(h("div", { class: "fade-in" },
      card({ title: "The metric catalogue", sub: `${METRICS.reduce((n, g) => n + g.m.length, 0)} metrics in ${METRICS.length} groups` }, grid)));
  }

  if (FOUR_REPORTS && FOUR_REPORTS.length) {
    page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
      card({ title: "Every experiment reports four things", sub: "baseline · delta · cost · guardrail" },
        h("div", { class: "grid g4" }, ...FOUR_REPORTS.map((r) =>
          h("div", { class: "card pad-sm" },
            h("div", { class: "kicker", text: r.k }),
            h("div", { style: { fontSize: "13px", color: "var(--ink-2)", marginTop: "6px" }, text: r.v })))))));
  }

  if (GUARDRAILS && GUARDRAILS.length) {
    page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
      card({ title: "Guardrails", sub: "the values that must not move" },
        h("ul", { class: "list check" }, ...GUARDRAILS.map((g) =>
          h("li", {}, h("span", { class: "dot" }), h("span", { text: typeof g === "string" ? g : g.t || g.name })))))));
  }

  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({},
      callout("<b>No corpus figure is a target.</b> The numbers in the source documents describe what happened in a particular corpus under particular conditions. They are not goals to hit, and treating them as goals is how a factory ends up optimising for a benchmark rather than for accepted, correct work.",
        "good"))));

  return page;
}

/* ============================================================
   STACKS — A1 stack neutrality
   ============================================================ */

export function renderStacks() {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Stack neutrality",
    "One factory, many languages",
    "The factory is defined in its own language, not in the language of the repo it works on. A1 is the rule set that makes that possible — and it is what stops the factory from becoming a TypeScript-shaped tool that only works on TypeScript repos."
  ));
  const { STACK_TIERS, FACTORY_PROFILES, TARGET_STACKS, CANONICAL_TASKS, ADAPTER_SWAPS } = DATA.BP;

  /* stack tiers — what is fixed vs what varies */
  if (STACK_TIERS && STACK_TIERS.length) {
    const grid = h("div", { class: "grid g4" });
    STACK_TIERS.forEach((t) => {
      const cardEl = h("div", { class: "card pad-sm" });
      cardEl.append(
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("span", { class: "tag", style: { color: t.color, borderColor: t.color, background: t.color + "22" }, text: t.name }),
          h("span", { class: "kicker", text: t.sub || "" })),
        h("ul", { class: "list", style: { marginTop: "9px" } },
          ...(t.items || []).map((i) => h("li", {}, h("span", { class: "dot" }), h("span", { text: i })))),
      );
      grid.append(cardEl);
    });
    page.append(h("div", { class: "fade-in" },
      card({ title: "The stack tier model", sub: "what is fixed, and what is allowed to vary" }, grid)));
  }

  if (FACTORY_PROFILES && FACTORY_PROFILES.length) {
    const grid = h("div", { class: "grid g2" });
    FACTORY_PROFILES.forEach((p) => {
      grid.append(h("div", { class: "card pad-sm" },
        h("div", { style: { display: "flex", gap: "9px", alignItems: "baseline" } },
          h("div", { style: { fontSize: "15px", fontWeight: "640" }, text: p.lang }),
          h("span", { class: "kicker", text: p.sub || "" })),
        h("div", { class: "mono", style: { fontSize: "11.8px", color: "var(--ink-2)", marginTop: "8px" }, text: p.stack })));
    });
    page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
      card({ title: "Factory-language profiles", sub: "the reference renderings" }, grid)));
  }

  if (TARGET_STACKS && TARGET_STACKS.length) {
    const grid = h("div", { class: "grid g2" });
    TARGET_STACKS.forEach((s) => {
      const cardEl = h("div", { class: "card pad-sm" });
      cardEl.append(h("div", { style: { fontSize: "14.6px", fontWeight: "640", marginBottom: "9px" }, text: s.name }));
      const dl = h("dl", { class: "kv" });
      [["install", s.install], ["static", s.static], ["type", s.type], ["test", s.test], ["oracle", s.oracle]]
        .forEach(([k, v]) => { if (v) { dl.append(h("dt", { text: k })); dl.append(h("dd", { class: "mono", style: { fontSize: "11.6px" }, text: v })); } });
      cardEl.append(dl);
      grid.append(cardEl);
    });
    page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
      card({ title: "Target stacks", sub: `${TARGET_STACKS.length} — what the factory can already drive` }, grid)));
  }

  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The twelve canonical tasks", sub: "every target stack must expose these by the same name" },
      h("div", { class: "tags" }, ...CANONICAL_TASKS.map((t) => h("span", { class: "tag a", text: t }))),
      h("div", { style: { fontSize: "13px", color: "var(--ink-2)", marginTop: "12px" },
        text: "If a repo cannot express these twelve, the factory cannot drive it. That is the whole contract — and it is what makes 'add a new language' an adapter problem rather than a rewrite." }))));

  if (ADAPTER_SWAPS && ADAPTER_SWAPS.length) {
    page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
      card({ title: "Adapter swap map", sub: "what changes when the target repo changes" },
        table(["From", "To", "Why"], ADAPTER_SWAPS.map((a) => ({
          cells: [h("b", { text: a.from || "" }), h("b", { text: a.to || "" }), a.why || a.d || ""],
        }))))));
  }

  return page;
}
