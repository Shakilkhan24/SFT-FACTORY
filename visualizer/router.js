/* ============================================================
   Router — tab registry + navigation (standalone)
   ============================================================ */

import { h } from "./dom.js";
import { applyFocus } from "./views/ui.js";

const TABS = [];
let current = "";
let currentCleanup = null;

export function defineTabs(list) { list.forEach((t) => TABS.push(t)); }
export function getTabs() { return TABS; }
export function currentTab() { return current; }

export function renderTabs() {
  const nav = document.getElementById("tabs");
  if (!nav) return;
  nav.innerHTML = "";
  for (const t of TABS) {
    const b = h("button", {
      class: "tab" + (t.id === current ? " on" : ""),
      role: "tab",
      type: "button",
      onclick: () => go(t.id),
    },
      t.icon ? h("span", { class: "tab-ico", text: t.icon }) : null,
      t.label,
    );
    nav.append(b);
  }
}

export function go(id, params) {
  if (currentCleanup) { try { currentCleanup(); } catch {} currentCleanup = null; }
  current = id;
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  if (!tab) return;
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  const p = params || {};
  const node = tab.render(p);
  if (node) main.append(node);
  main.scrollTop = 0;
  renderTabs();
  currentCleanup = tab.cleanup || null;
  try { location.hash = id; } catch {}
  /* highlight the record a cross-reference jumped to */
  if (p.focus) {
    requestAnimationFrame(() => {
      applyFocus(main, p.focus);
      const el = main.querySelector(`[data-fid="${String(p.focus).replace(/"/g, '\\"')}"]`);
      if (el && el.scrollIntoView) {
        try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
      }
    });
  }
}

export function navigate(id, params) { go(id, params); }

export function observeReveals(root) {
  if (!root) return;
  const els = root.querySelectorAll(".reveal");
  if (!els || !els.length) return;
  if (!("IntersectionObserver" in globalThis)) { els.forEach((e) => e.classList.add("shown")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("shown"); io.unobserve(en.target); }
    });
  }, { root, threshold: 0.06, rootMargin: "0px 0px -40px 0px" });
  els.forEach((e) => io.observe(e));
}
