/* ============================================================
   Shared UI primitives for the visualizer
   ============================================================ */

import { h, nl2br } from "../dom.js";
import { openDrawer } from "../drawer.js";
import { linkify } from "./refs.js";

/* Prose that may contain record IDs gets linkified automatically.
   `html:` fields are trusted markup, so linkify preserves tags. */
const P = (s) => linkify(nl2br(s));

/**
 * A paragraph of prose whose record IDs become clickable cross-references.
 * Use this instead of h("p", { text: ... }) for any descriptive sentence.
 */
export function prose(text, cls = "") {
  return h("p", { class: cls, html: P(text) });
}

/** Inline prose span (no block wrapper). */
export function proseSpan(text, cls = "") {
  return h("span", { class: cls, html: P(text) });
}

export function card(opts = {}, ...kids) {
  const c = h("div", { class: "card" + (opts.cls ? " " + opts.cls : "") });
  if (opts.title) {
    const head = h("div", { class: "card-h" },
      h("h3", { text: opts.title }),
      opts.sub ? h("span", { class: "sub", text: opts.sub }) : null,
    );
    c.append(head);
  }
  if (opts.kicker) c.append(h("div", { class: "kicker", text: opts.kicker }));
  c.append(...kids.flat(3).filter(Boolean));
  return c;
}

export function pageHead(eyebrow, title, lede) {
  return h("div", { class: "phead fade-in" },
    h("div", { class: "eyebrow", text: eyebrow }),
    h("h2", { text: title }),
    lede ? h("p", { class: "lede", html: P(lede) }) : null,
  );
}

export function tag(text, cls = "") { return h("span", { class: "tag " + cls, text }); }

export function tags(list, cls = "") { return h("div", { class: "tags" }, ...list.map((t) => tag(t, cls))); }

export function accordion(items, opts = {}) {
  const wrap = h("div", {});
  items.forEach((it, i) => {
    const acc = h("div", { class: "acc frec", "data-fid": it.fid || "" });
    const bodyId = "acc-b-" + Math.random().toString(36).slice(2, 8);
    const head = h("button", { class: "acc-h", type: "button", onclick: () => acc.classList.toggle("open") },
      it.id ? h("span", { class: "acc-id", text: it.id }) : null,
      h("span", { class: "acc-t", html: linkify(String(it.title ?? "")) }),
      it.count ? h("span", { class: "acc-c", text: it.count }) : null,
      h("span", { class: "caret", html: "&#9656;" }),
    );
    const body = h("div", { class: "acc-b", id: bodyId });
    const content = typeof it.body === "function" ? it.body() : it.body;
    if (content) body.append(content);
    acc.append(head, body);
    wrap.append(acc);
  });
  return wrap;
}

export function table(headers, rows) {
  const t = h("table", { class: "tbl" });
  t.append(h("thead", {}, h("tr", {}, ...headers.map((x) => h("th", { text: x })))));
  const tb = h("tbody", {});
  rows.forEach((r) => {
    const spec = r && !Array.isArray(r) && r.cells ? r : { cells: r };
    const tr = h("tr", { class: "frec", "data-fid": spec.fid || "" });
    (spec.cells || []).forEach((c) => {
      tr.append(h("td", { html: c === null || c === undefined ? "" : linkify(String(c)) }));
    });
    tb.append(tr);
  });
  t.append(tb);
  return h("div", { class: "tbl-scroll" }, t);
}

export function stat(label, value, sub) {
  return h("div", { class: "card pad-sm" },
    h("div", { class: "kicker", text: label }),
    h("div", { class: "stat-row", style: { marginTop: "6px" } },
      h("span", { class: "big-num", text: String(value) }),
      sub ? h("span", { class: "stat-lbl", text: sub }) : null,
    ),
  );
}

export function callout(text, kind = "") {
  return h("div", { class: "callout " + kind, html: P(text) });
}

export function kv(pairs) {
  const d = h("dl", { class: "kv" });
  pairs.forEach(([k, v]) => {
    d.append(h("dt", { text: k }));
    d.append(h("dd", { html: v === null || v === undefined ? "—" : linkify(String(v)) }));
  });
  return d;
}

/* Open a record in the global drawer. */
export function drawerRecord(kicker, title, sections) {
  const body = h("div", {});
  sections.forEach((s) => {
    if (typeof s === "string") { body.append(h("p", { html: P(s) })); return; }
    if (s.h) body.append(h("h4", { text: s.h }));
    if (s.p) body.append(h("p", { html: P(s.p) }));
    if (s.kv) body.append(kv(s.kv));
    if (s.list) {
      const ul = h("ul", {});
      s.list.forEach((x) => ul.append(h("li", { html: linkify(String(x)) })));
      body.append(ul);
    }
    if (s.tags) body.append(h("div", { class: "tags" }, ...s.tags.map((t) => tag(t.text || t, t.cls || ""))));
    if (s.node) body.append(s.node);
  });
  openDrawer(kicker, title, body);
}

export function reveal(cls = "") {
  return h("div", { class: "reveal " + cls });
}

/* ============================================================
   FOCUS — highlight a record after navigation
   Any element carrying data-fid="<record id>" can be targeted.
   ============================================================ */

/** Mark an element as a focusable record anchor. */
export function fid(id, cls = "") {
  return { "data-fid": String(id), class: cls ? "frec " + cls : "frec" };
}

/**
 * Scroll to and flash the record whose data-fid matches.
 * Called after a view renders, when navigated with { focus: "<id>" }.
 */
export function applyFocus(root, id) {
  if (!root || !id) return;
  const sel = `[data-fid="${String(id).replace(/"/g, '\\"')}"]`;
  const el = root.querySelector(sel);
  if (!el) return;
  /* if it lives inside a collapsed accordion, open it first */
  const acc = el.closest ? el.closest(".acc") : null;
  if (acc) acc.classList.add("open");
  el.classList.add("flash");
  try {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    /* older engines */
  }
  setTimeout(() => el.classList.remove("flash"), 2400);
}
