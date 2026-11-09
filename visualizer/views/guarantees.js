/* ============================================================
   VIEWS — Guarantees, security, levels, decisions, glossary
   ============================================================ */

import { h, esc } from "../dom.js";
import { DATA } from "../data/index.js";
import { CX_INVARIANTS } from "../data/07-context.js";
import { QE_INVARIANTS } from "../data/09-quality.js";
import { card, pageHead, tag, tags, callout, table, accordion, drawerRecord, kv, prose, proseSpan } from "./ui.js";
import { linkify } from "./refs.js";

const { INVARIANTS, ATTACKS, ALGORITHMS, PRD } = DATA;
const {
  INJECTION_CONTROLS, THREAT_ACTORS, TRUST_CLASSES, FAILURE_CLASSES, ESCALATION_TRIGGERS,
} = DATA;
const { AUTONOMY, TIERS, ISOLATION, EFFECT_CLASSES, ACCESS_POINTS, CONTROL_VERBS, AGENTS } = DATA;

/* ============================================================
   GUARANTEES — invariants + attacks
   ============================================================ */

export function renderGuarantees(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The guarantees",
    "Twelve invariants, fifteen attacks, and the defences between them",
    "An invariant is a property the factory must hold no matter what. An attack is a way to try to break it. A defence is what stops it. This is the part of the blueprint you point at when someone asks 'but what if the model misbehaves?'"
  ));

  /* invariant grid */
  const grid = h("div", { class: "grid g2" });
  INVARIANTS.forEach((inv, i) => {
    const c = h("div", { class: "card click frec", "data-fid": inv.id, onclick: () => openInv(inv) });
    c.append(
      h("div", { style: { display: "flex", gap: "9px", alignItems: "center", marginBottom: "7px" } },
        h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700", fontSize: "13px" }, text: inv.id }),
        h("span", { class: "tag g", text: "enforced" })),
      h("div", { style: { fontSize: "14.6px", fontWeight: "600", lineHeight: "1.45" }, text: inv.t }),
      proseSpan(inv.enforced, "dim-note"),
      h("div", { class: "mono", style: { fontSize: "11.4px", color: "var(--accent-2)", marginTop: "8px" }, text: inv.proof }),
    );
    grid.append(c);
  });
  page.append(h("div", { class: "fade-in" }, grid));

  /* attacks */
  const byKind = {};
  ATTACKS.forEach((a) => { (byKind[a.kind] = byKind[a.kind] || []).push(a); });

  const attackCard = card({ title: "Red-team suite", sub: `${ATTACKS.length} attacks across ${Object.keys(byKind).length} classes` });
  attackCard.append(accordion(Object.entries(byKind).map(([kind, list]) => ({
    id: kind,
    title: kind.charAt(0).toUpperCase() + kind.slice(1),
    count: `${list.length} attacks`,
    open: kind === "injection",
    body: () => {
      const wrap = h("div", {});
      list.forEach((a) => {
        const d = h("div", { class: "card pad-sm frec", "data-fid": a.id, style: { marginBottom: "9px" } });
        d.append(
          h("div", { style: { display: "flex", gap: "9px", alignItems: "center", marginBottom: "6px" } },
            h("span", { class: "mono", style: { color: "var(--bad)", fontWeight: "700", fontSize: "12.4px" }, text: a.id }),
            h("div", { style: { fontSize: "14px", fontWeight: "620" }, text: a.name })),
          proseSpan(a.desc, "ink2"),
          h("div", { style: { fontSize: "12.8px", color: "var(--good)", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(34,48,77,.6)" }, html: "<b>Defence:</b> " + esc(a.defence) }),
        );
        wrap.append(d);
      });
      return wrap;
    },
  }))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, attackCard));

  return page;
}

function openInv(inv) {
  const related = ATTACKS.filter((a) => (inv.proof || "").includes(a.id.replace("AT-", "")) );
  drawerRecord(`Invariant ${inv.id}`, inv.t, [
    { h: "How it is enforced", p: inv.enforced },
    { kv: [["Proof obligation", inv.proof]] },
    { h: "The point", p: "This is enforced by structure, not by vigilance. A component that cannot reach the thing it would need to violate the invariant simply does not have the path." },
  ]);
}

/* ============================================================
   SECURITY
   ============================================================ */

export function renderSecurity(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Security",
    "Six controls, six threat actors, three trust classes",
    "The single most important idea in the blueprint: untrusted content is data, never instruction. Everything on this page is machinery for keeping that true."
  ));

  /* injection chain */
  const chain = h("div", {});
  INJECTION_CONTROLS.forEach((c, i) => {
    const item = h("div", { class: "pipe-step" + (c.n === 4 ? " key" : "") },
      h("div", { class: "pipe-rail" }, h("div", { class: "pipe-dot", text: String(c.n) })),
      h("div", { class: "pipe-body" },
        h("div", { style: { display: "flex", gap: "9px", alignItems: "center", flexWrap: "wrap" } },
          h("div", { class: "pipe-title", text: c.name }),
          h("span", { class: "tag v", text: c.where })),
        h("div", { style: { fontSize: "13.2px", color: "var(--ink-2)", marginTop: "8px" }, text: c.what }),
      ),
    );
    chain.append(item);
  });
  page.append(h("div", { class: "card fade-in" },
    h("div", { class: "card-h" }, h("h3", { text: "The injection control chain" }), h("span", { class: "sub", text: "each control is a link; removing one opens the path" })),
    chain));

  /* threat actors */
  const ta = h("div", { class: "grid g3" });
  THREAT_ACTORS.forEach((t) => {
    ta.append(h("div", { class: "card pad-sm" },
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
        h("span", { class: "tag b", text: t.id }),
        h("div", { style: { fontSize: "14px", fontWeight: "620" }, text: t.name })),
      h("div", { style: { fontSize: "12.8px", color: "var(--ink-2)", marginTop: "7px" }, text: t.how })));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Threat actors", sub: "who the factory is defending against" }, ta)));

  /* trust classes */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Trust classes", sub: "every piece of content has exactly one" },
      table(["Class", "Definition"], TRUST_CLASSES.map((t) => ({
        cells: [
          h("span", { class: "tag " + (t.id === "trusted" ? "g" : t.id === "untrusted-content" ? "b" : "a"), text: t.id }),
          t.what,
        ],
      }))),
      h("div", { style: { marginTop: "12px" } },
        callout("<b>Untrusted content is data, never instruction.</b> That single rule is what the six injection controls above are machinery for. An issue body, a PR description, a code comment, a web page, a dependency file, an external tool output — all are tagged at ingest, fenced, placed last in the envelope, and passed as data. No tool and no grant is ever derived from them.")))));

  /* context-layer security invariants — the ones that belong to this page too */
  const ctxSec = CX_INVARIANTS.filter((c) =>
    /untrusted|privileged|central security|integrity|authority|deterministic|version/i.test(c.t + " " + c.enf));
  if (ctxSec.length) {
    const cg = h("div", { class: "grid g2" });
    ctxSec.forEach((c) => {
      cg.append(h("div", { class: "card pad-sm frec", "data-fid": c.id },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700" }, text: c.id }),
          h("div", { style: { fontSize: "13.4px", fontWeight: "640" }, text: c.t })),
        h("div", { style: { fontSize: "12.6px", color: "var(--ink-2)", marginTop: "7px" }, text: c.enf })));
    });
    page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
      card({ title: "Context-layer invariants", sub: "the guarantees that live in the context model, not the policy engine" },
        cg,
        h("div", { style: { marginTop: "12px" } },
          callout("These are enforced by the <b>context assembler</b>, not by the policy engine. A control that only exists in the prompt is not a control — see <b>Context & memory</b> for the machinery behind each one.")))));
  }

  /* quality invariants — the ones that belong to this page too */
  const qeSec = QE_INVARIANTS.filter((q) =>
    /gate|oracle|verif|calibrat|red.team|attack|merge|approval|evidence|audit|gate/i.test(q.t + " " + q.enf));
  if (qeSec.length) {
    const qg = h("div", { class: "grid g2" });
    qeSec.forEach((q) => {
      qg.append(h("div", { class: "card pad-sm frec", "data-fid": q.id },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("span", { class: "mono", style: { color: "var(--accent-2)", fontWeight: "700" }, text: q.id }),
          h("div", { style: { fontSize: "13.4px", fontWeight: "640" }, text: q.t })),
        h("div", { style: { fontSize: "12.6px", color: "var(--ink-2)", marginTop: "7px" }, text: q.enf })));
    });
    page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
      card({ title: "Quality invariants", sub: "the guarantees that live in the merge gate, not the policy engine" },
        qg,
        h("div", { style: { marginTop: "12px" } },
          callout("These are enforced by the <b>merge gate and the calibration harness</b>. A control that is never verified is a claim, not a control — see <b>Quality & verification</b> for the machinery behind each one.")))));
  }

  /* escalation triggers + failure classes */
  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } },
    card({ title: "Escalation triggers", sub: "when the factory hands the problem back to a human" },
      h("ul", { class: "list" }, ...ESCALATION_TRIGGERS.map((t) =>
        h("li", {}, h("span", { class: "dot" }), h("span", { text: t })))),
      h("div", { style: { marginTop: "12px" } },
        callout("<b>Escalated is not failed.</b> It is resumable. The distinction matters: a failed task is dead, an escalated task is waiting for a human and can continue from where it stopped."))),
    card({ title: "Failure classes", sub: "retry policy by cause" },
      table(["Class", "Retries", "Outcome"], FAILURE_CLASSES.map((f) => ({
        cells: [h("span", { class: "mono", text: f.id }), f.retry, f.outcome],
      }))))
  ));

  return page;
}

/* ============================================================
   LEVELS — autonomy, tiers, isolation, effect classes
   ============================================================ */

export function renderLevels() {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The dials",
    "Autonomy, blast radius, isolation and effect class",
    "Four independent dials. Every task carries a value for each. Changing one does not change the others — and that is the point: the factory can be extremely capable at one thing and absolutely locked down about another."
  ));

  /* autonomy ladder */
  const ladder = h("div", {});
  AUTONOMY.forEach((a, i) => {
    const row = h("div", { class: "pipe-step" + (a.v1 ? " now" : "") });
    row.append(
      h("div", { class: "pipe-rail" }, h("div", { class: "pipe-dot", text: a.id })),
      h("div", { class: "pipe-body" },
        h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
          h("div", { class: "pipe-title", text: a.name }),
          a.v1 ? h("span", { class: "tag g", text: "v1 default" }) : h("span", { class: "tag w", text: "not in v1" })),
        h("div", { style: { fontSize: "13.2px", color: "var(--ink-2)", marginTop: "8px" }, text: a.can }),
      ),
    );
    ladder.append(row);
  });
  page.append(h("div", { class: "card fade-in" },
    h("div", { class: "card-h" }, h("h3", { text: "The autonomy ladder" }), h("span", { class: "sub", text: "L0 → L4" })),
    ladder,
    h("div", { style: { marginTop: "14px" } },
      callout("<b>The floor.</b> Human reading of code is mandatory until a workflow's verifier set is discriminator-calibrated. The blueprint deliberately gives up the corpus's headline throughput claims in exchange for a defensible quality position — that is why the default is L2, not L3. (ADR-0003)"))));

  /* tiers */
  page.append(h("div", { class: "grid g2", style: { marginTop: "18px" } },
    card({ title: "Blast radius tiers", sub: "score → tier → gate set" },
      table(["Tier", "Name", "Score", "Required gates"], TIERS.map((t) => ({
        cells: [h("span", { class: "tag a", text: t.id }), h("b", { text: t.name }), h("span", { class: "mono", text: t.score }), t.gates],
      }))),
      h("div", { style: { marginTop: "12px" } },
        callout("<b>The asymmetry rule.</b> Blast radius may be raised by a human at any time; it may be lowered only by a reviewed policy change. And the tier is never just the score — a criticality map sets a floor.", "warn"))),
    card({ title: "Isolation tiers", sub: "where the code runs" },
      table(["Tier", "Name", "What it is"], ISOLATION.map((t) => ({
        cells: [h("span", { class: "tag v", text: t.id }), h("b", { text: t.name }), t.what],
      }))),
      h("div", { style: { marginTop: "12px" } },
        callout("<b>T2 is mandatory</b> for any stage that executes repo code, including verification. T1 is cheap and isolated but does not execute code.")))
  ));

  /* effect classes */
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "Effect classes", sub: "what the policy engine checks before anything happens" },
      table(["Class", "Name", "Policy rule"], EFFECT_CLASSES.map((t) => ({
        cells: [h("span", { class: "tag h", text: t.id }), h("b", { text: t.name }),
          h("span", { style: { color: t.rule.startsWith("REQUIRE") ? "var(--bad)" : "var(--good)" }, text: t.rule })],
      }))))));

  /* access points */
  const ap = h("div", { class: "grid g2" });
  ACCESS_POINTS.forEach((a) => {
    ap.append(h("div", { class: "card pad-sm" },
      h("div", { style: { display: "flex", gap: "9px", alignItems: "center", flexWrap: "wrap" } },
        h("span", { class: "tag a", text: a.id }),
        h("div", { style: { fontSize: "14.4px", fontWeight: "620" }, text: a.verb })),
      h("div", { class: "mono", style: { fontSize: "12px", color: "var(--accent-2)", marginTop: "7px" }, text: a.body }),
      h("div", { style: { fontSize: "12.6px", color: "var(--ink-3)", marginTop: "7px" }, text: a.auth })));
  });
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "The six access points", sub: "there is no informal 'chat with the agent' path", cls: "" }, ap,
      h("div", { style: { marginTop: "13px" } },
        callout("<b>AP-6 is the one that makes the factory itself safe.</b> The dashboard may observe, pause, cancel, escalate and propose — but it may never write. Amending the factory requires a merged git SHA and an approval ID. Every factory change is a reviewable diff, so privilege escalation cannot happen silently. (ADR-0001)")))));

  /* control verbs */
  page.append(h("div", { class: "card fade-in", style: { marginTop: "18px" } },
    h("div", { class: "card-h" }, h("h3", { text: "Control verbs" }), h("span", { class: "sub", text: "what a human may do to a running task" })),
    h("div", { class: "tags" }, ...CONTROL_VERBS.map((v) => h("span", { class: "tag a", text: v }))),
    h("div", { style: { fontSize: "12.8px", color: "var(--ink-3)", marginTop: "11px" }, text: "Plus a kill switch. 'Grant (temporary)' is explicitly temporary — a grant that outlives its window is a bug, not a policy." })));

  return page;
}

/* ============================================================
   DECISIONS — ADRs, D1-D10, questions, hypotheses
   ============================================================ */

export function renderDecisions(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Decisions",
    "The arguments the blueprint settled",
    "Twelve architecture decision records, ten owner decisions that have no default, twenty-one open questions and twelve hypotheses. The ADRs are the ones with consequences — each one says what it costs."
  ));

  const { ADRS, DECISIONS, QUESTIONS, HYPOTHESES } = DATA.BP;

  /* ADRs */
  const adrCard = card({ title: "Architecture decision records", sub: `${ADRS.length} — each with its consequence` });
  adrCard.append(accordion(ADRS.map((a) => ({
    id: a.n,
    fid: a.n,
    title: a.title,
    count: a.critical ? "critical" : "",
    open: a.critical,
    body: () => {
      const wrap = h("div", {});
      wrap.append(
        h("div", { class: "kicker", text: "Decision" }),
        prose(a.decision, "mb12"),
        h("div", { class: "kicker", text: "Consequence" }),
        prose(a.consequence),
        a.hard ? h("div", { style: { marginTop: "12px" } }, callout("<b>The hard part:</b> " + a.hard, "warn")) : null,
        a.interfaceRule ? h("div", { style: { marginTop: "10px" } }, callout("<b>Interface rule:</b> " + a.interfaceRule, "good")) : null,
        h("div", { style: { marginTop: "12px" } }, h("div", { class: "tags" },
          tag("evidence: " + a.ev, "v"),
          a.critical ? tag("load-bearing", "h") : null)),
      );
      return wrap;
    },
  }))));
  page.append(h("div", { class: "fade-in" }, adrCard));

  /* D1-D10 */
  const dCard = card({ title: "Owner decisions D1–D10", sub: "these have no default — the owner must answer" });
  dCard.append(table(["ID", "Question", "Default / recommendation", "Blocks", ""], DECISIONS.map((d) => ({
    fid: d.id,
    cells: [
      h("span", { class: "id", text: d.id }),
      h("span", { html: `<b>${esc(d.q)}</b>` }),
      h("span", { html: linkify(String(d.def || "")) }),
      h("span", { class: "mono", style: { fontSize: "11.4px" }, html: linkify(String(d.blocks || "")) }),
      d.matters ? h("span", { class: "tag w", text: "matters" }) : "",
    ],
  }))));
  dCard.append(h("div", { style: { marginTop: "13px" } },
    callout("<b>D1 and D10 are the two that actually gate the plan.</b> D1 (the target repo) blocks the whole spine, and D10 (daily review time) determines whether the approval model is even viable — a factory that generates more than a person can review in two hours is a factory that produces unreviewed work.")));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, dCard));

  /* questions */
  const qCard = card({ title: "Open questions", sub: `${QUESTIONS.length} — the gaps the blueprint admits it has` });
  qCard.append(accordion(QUESTIONS.map((q) => ({
    id: q.id,
    fid: q.id,
    title: q.q || q.question || "",
    count: q.key ? "key" : "",
    open: q.key,
    body: () => h("div", {},
      q.why ? prose(q.why) : null,
      q.handle ? h("div", { style: { marginTop: "10px" } }, callout("<b>How the blueprint handles it:</b> " + q.handle)) : null,
      q.by ? h("div", { class: "mono", style: { fontSize: "11.6px", color: "var(--ink-3)", marginTop: "9px" }, text: "answered by: " + q.by }) : null),
  }))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, qCard));

  /* hypotheses */
  const hCard = card({ title: "Hypotheses", sub: `${HYPOTHESES.length} — what the factory is betting on` });
  hCard.append(accordion(HYPOTHESES.map((x) => ({
    id: x.id,
    fid: x.id,
    title: x.t || x.h || "",
    count: x.key ? "key" : "",
    open: x.key,
    body: () => h("div", {},
      x.why ? prose(x.why) : null,
      x.wrong ? h("div", { style: { marginTop: "10px" } }, callout("<b>How you would know it is wrong:</b> " + x.wrong, "warn")) : null,
      x.test ? h("div", { style: { fontSize: "12.8px", color: "var(--ink-3)", marginTop: "9px" }, html: "Test: " + linkify(String(x.test)) }) : null),
  }))));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } }, hCard));

  return page;
}

/* ============================================================
   RISKS
   ============================================================ */

export function renderRisks(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Risks",
    "What could go wrong, and what the blueprint does about it",
    "A risk register that names the actual failure modes — including the ones that are uncomfortable to admit, like the factory generating more work than a human can review."
  ));
  const { RISKS, PACK_RISKS } = DATA.BP;

  const riskTable = (list, title, sub) => {
    const c = card({ title, sub });
    c.append(table(["ID", "Risk", "Likelihood", "Impact", "Mitigation"], list.map((r) => ({
      fid: r.id,
      cells: [
        h("span", { class: "id", text: r.id }),
        h("span", { html: `<b>${esc(r.t || r.title || r.name || "")}</b>` }),
        h("span", { class: "tag " + sev(r.l), text: r.l || "—" }),
        h("span", { class: "tag " + sev(r.i), text: r.i || "—" }),
        h("span", { html: linkify(String(r.m || r.mitigation || "")) }),
      ],
    }))));
    return c;
  };

  page.append(h("div", { class: "fade-in" }, riskTable(RISKS, "Blueprint risk register", `${RISKS.length} risks`)));
  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    riskTable(PACK_RISKS, "Implementation-pack risks", `${PACK_RISKS.length} risks`)));

  return page;
}

function sev(s) {
  const v = String(s || "").toLowerCase();
  if (v.includes("high") || v.includes("crit")) return "b";
  if (v.includes("med")) return "w";
  if (v.includes("low")) return "g";
  return "";
}

/* ============================================================
   GLOSSARY
   ============================================================ */

export function renderGlossary(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "Glossary",
    "Every term the blueprint uses",
    "If a word in this visualizer does not make sense, it is probably defined here."
  ));
  const G = DATA.BP.GLOSSARY || [];
  const cats = {};
  G.forEach((g) => { (cats[g.k] = cats[g.k] || []).push(g); });

  const bar = h("div", { class: "filter-bar" });
  const inp = h("input", { type: "search", placeholder: "Filter terms…" });
  const note = h("span", { class: "filter-note" });
  bar.append(inp, note);

  const wrap = h("div", {});
  function renderG() {
    const q = inp.value.toLowerCase();
    wrap.innerHTML = "";
    let count = 0;
    for (const [k, list] of Object.entries(cats)) {
      const filtered = list.filter((g) => !q || (g.t + " " + g.d).toLowerCase().includes(q));
      if (!filtered.length) continue;
      count += filtered.length;
      const sec = h("div", { class: "card", style: { marginBottom: "16px" } });
      sec.append(h("div", { class: "card-h" }, h("h3", { text: k }), h("span", { class: "sub", text: `${filtered.length} terms` })));
      sec.append(table(["Term", "Definition"], filtered.map((g) => ({
        cells: [h("b", { text: g.t }), g.d],
      }))));
      wrap.append(sec);
    }
    if (!count) wrap.append(h("div", { class: "sr-empty", text: "No terms match." }));
    note.textContent = `${count} of ${G.length} terms`;
  }
  inp.addEventListener("input", renderG);
  page.append(h("div", { class: "fade-in" }, bar, wrap));
  renderG();
  return page;
}
