/* ============================================================
   VIEW — The six authoring templates
   What you would actually write, and the rules that govern it
   ============================================================ */

import { h, esc } from "../dom.js";
import { TEMPLATES } from "../data/08-templates.js";
import { card, pageHead, tag, callout, table, drawerRecord, kv, prose } from "./ui.js";
import { linkify } from "./refs.js";

export function renderTemplates(params = {}) {
  const page = h("div", { class: "page" });
  page.append(pageHead(
    "The authoring contracts",
    "Six templates — the shape of everything you will write",
    "The blueprint does not just describe a factory; it specifies how to author its parts. Each of these six templates is a contract: it says when to use it, who reviews it, and the rules you must not break. This page is the answer to “what does my first file look like?”"
  ));

  /* --- the six, at a glance --- */
  const grid = h("div", { class: "grid g3" });
  TEMPLATES.forEach((t) => {
    const cardEl = h("div", { class: "card click frec", "data-fid": t.file, onclick: () => openTemplate(t) });
    cardEl.append(
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
        h("span", { class: "tag v", text: t.file.replace(".md", "") }),
        t.kind ? h("span", { class: "mono", style: { fontSize: "11px", color: "var(--accent-2)" }, text: t.kind }) : null),
      h("div", { style: { fontSize: "15px", fontWeight: "640", marginTop: "8px" }, text: t.title }),
      h("div", { style: { fontSize: "12.8px", color: "var(--ink-2)", marginTop: "7px" }, text: t.useWhen }),
      h("div", { style: { display: "flex", gap: "7px", marginTop: "10px", flexWrap: "wrap" } },
        h("span", { class: "tag", text: t.rules.length + " rules" }),
        h("span", { class: "tag", text: t.checklist.length + " checks" }),
        t.worked ? h("span", { class: "tag g", text: "worked example" }) : null),
    );
    grid.append(cardEl);
  });
  page.append(h("div", { class: "fade-in" }, grid));

  /* --- how they fit together --- */
  const lifecycle = h("div", {},
    h("div", { class: "kicker", text: "The lifecycle of one change" }),
    h("ol", { class: "list num" },
      h("li", {}, h("span", { class: "dot" }), h("span", { html: "<b>ADR</b> — a decision is made and recorded. Alternatives are mandatory, consequences include what is given up, and the decision states how it could be shown wrong." })),
      h("li", {}, h("span", { class: "dot" }), h("span", { html: "<b>Agent spec / workflow / skill spec / MCP integration</b> — the definition change that implements it, each with its own authoring rules." })),
      h("li", {}, h("span", { class: "dot" }), h("span", { html: "<b>Experiment</b> — the evidence. Four elements, always: baseline, delta, cost, guardrail. A change with no baseline is not evidence." })),
      h("li", {}, h("span", { class: "dot" }), h("span", { html: "<b>Review</b> — at the approval class matching the blast radius. A decision touching policy or autonomy is a security-scope decision." }))));

  const privilege = h("div", {},
    h("div", { class: "kicker", text: "Every one of them is a definition change" }),
    h("div", { style: { fontSize: "13.2px", color: "var(--ink-2)", lineHeight: "1.6" }, text: "Nothing here is a privileged artefact. An ADR, a role spec, a skill, a workflow and an integration all travel the same reviewed path — the same one any other code change travels. The factory has no privileged path, not even for the factory itself." }),
    h("div", { style: { marginTop: "12px" } },
      callout("An <b>experiment report is not a decision.</b> It is an evidence artefact that accompanies a proposal. It authorises nothing. A proposal that references a report with a missing element is rejected at validation.")));

  page.append(h("div", { class: "fade-in", style: { marginTop: "18px" } },
    card({ title: "How the six fit together", sub: "one change, four artefacts" },
      h("div", { class: "grid g2", style: { gap: "14px" } }, lifecycle, privilege))));

  /* --- the detail: one section per template --- */
  TEMPLATES.forEach((t) => {
    page.append(renderTemplate(t));
  });

  return page;
}

/* ============================================================
   ONE TEMPLATE, IN FULL
   ============================================================ */

function renderTemplate(t) {
  const wrap = h("div", { class: "fade-in", style: { marginTop: "18px" } });

  const body = card({});
  body.append(h("div", { style: { display: "flex", gap: "10px", alignItems: "baseline", flexWrap: "wrap", marginBottom: "10px" } },
    h("span", { class: "tag v", text: t.file }),
    h("div", { style: { fontSize: "17px", fontWeight: "650" }, text: t.title }),
    t.kind ? h("span", { class: "mono", style: { fontSize: "11.4px", color: "var(--accent-2)" }, text: t.kind }) : null,
  ));

  body.append(kv([
    ["Use when", t.useWhen],
    ["Authority", t.authority],
    ["Submission", t.submission],
  ]));

  /* authoring rules */
  body.append(h("div", { class: "kicker", style: { marginTop: "16px" }, text: `Authoring rules — ${t.rules.length}` }));
  const rules = h("div", { class: "grid g2", style: { gap: "10px", marginTop: "6px" } });
  t.rules.forEach((r) => {
    rules.append(h("div", { class: "card pad-sm" },
      h("div", { style: { display: "flex", gap: "9px", alignItems: "flex-start" } },
        h("span", { class: "mono", style: { color: "var(--accent)", fontWeight: "700", fontSize: "11.5px" }, text: String(r.n) }),
        h("div", { style: { fontSize: "13px", lineHeight: "1.5" }, html: linkify(r.t) }))));
  });
  body.append(rules);

  /* the template body itself */
  body.append(h("div", { class: "kicker", style: { marginTop: "16px" }, text: "The template" }));
  const pre = h("pre", { class: "tpl-pre" });
  pre.append(h("code", { text: t.body }));
  body.append(h("div", { class: "tpl-code" }, pre));

  /* review checklist */
  if (t.checklist.length) {
    body.append(h("div", { class: "kicker", style: { marginTop: "16px" }, text: `Review checklist — ${t.checklist.length} items` }));
    const ul = h("ul", { class: "list check" });
    t.checklist.forEach((c) => ul.append(h("li", {}, h("span", { class: "dot" }), h("span", { html: linkify(c) }))));
    body.append(ul);
  }

  wrap.append(body);
  return wrap;
}

function openTemplate(t) {
  drawerRecord(`Template — ${t.file}`, t.title, [
    { kv: [["Kind", t.kind || "—"], ["Use when", t.useWhen], ["Authority", t.authority], ["Submission", t.submission]] },
    { h: "Authoring rules", p: t.rules.map((r) => `${r.n}. ${r.t}`).join("\n\n") },
    { h: "Review checklist", p: t.checklist.map((c) => "☐ " + c).join("\n") },
    { h: "The template", p: t.body },
  ]);
}
