/* ============================================================
   VIEW REGISTRY
   ============================================================ */

import { defineTabs } from "../router.js";
import { setTour } from "../tour.js";
import { renderMap } from "./map.js";
import { renderWorkflows, renderStates, renderAgents } from "./workflows.js";
import { renderRoadmap } from "./roadmap.js";
import { renderGuarantees, renderSecurity, renderLevels, renderDecisions, renderRisks, renderGlossary } from "./guarantees.js";
import { renderStart, renderCommitments, renderAccess, renderAlgorithms, renderMetrics, renderStacks } from "./misc.js";
import { renderSimulation } from "./sim.js";
import { renderData, renderIntegrations } from "./data.js";
import { renderCoverage } from "./coverage.js";
import { renderConsistency } from "./consistency.js";
import { renderTrace } from "./trace.js";
import { renderContext } from "./context.js";
import { renderTemplates } from "./templates.js";
import { renderQuality } from "./quality.js";

export function registerViews() {
  defineTabs([
    { id: "start", label: "Start here", icon: "◈", render: renderStart },
    { id: "sim", label: "Live simulation", icon: "⏵", render: renderSimulation },
    { id: "map", label: "Architecture map", icon: "⬡", render: renderMap },
    { id: "commitments", label: "Commitments", icon: "❖", render: renderCommitments },
    { id: "workflows", label: "Workflows", icon: "▶", render: renderWorkflows },
    { id: "states", label: "State machine", icon: "◇", render: renderStates },
    { id: "context", label: "Context & memory", icon: "◧", render: renderContext },
    { id: "templates", label: "Authoring templates", icon: "✎", render: renderTemplates },
    { id: "quality", label: "Quality & verification", icon: "⊙", render: renderQuality },
    { id: "agents", label: "Agents", icon: "☺", render: renderAgents },
    { id: "levels", label: "Levels & tiers", icon: "▤", render: renderLevels },
    { id: "access", label: "Access points", icon: "⌨", render: renderAccess },
    { id: "security", label: "Security", icon: "⛨", render: renderSecurity },
    { id: "guarantees", label: "Guarantees", icon: "✓", render: renderGuarantees },
    { id: "algorithms", label: "Algorithms", icon: "ƒ", render: renderAlgorithms },
    { id: "data", label: "Data model", icon: "⛁", render: renderData },
    { id: "integrations", label: "Integrations", icon: "⇋", render: renderIntegrations },
    { id: "roadmap", label: "Roadmap", icon: "▦", render: renderRoadmap },
    { id: "decisions", label: "Decisions", icon: "⚖", render: renderDecisions },
    { id: "risks", label: "Risks", icon: "⚠", render: renderRisks },
    { id: "coverage", label: "Coverage", icon: "◫", render: renderCoverage },
    { id: "consistency", label: "Consistency", icon: "⚖", render: renderConsistency },
    { id: "trace", label: "Traceability", icon: "⇄", render: renderTrace },
    { id: "metrics", label: "Measurement", icon: "∿", render: renderMetrics },
    { id: "stacks", label: "Stack neutrality", icon: "⇄", render: renderStacks },
    { id: "glossary", label: "Glossary", icon: "⌸", render: renderGlossary },
  ]);

  setTour([
    {
      title: "What a software factory is",
      text: "Not an AI tool, not an autonomous company, not a model with a repository attached. <b>It is an organisation whose production cycle is performed by agents</b>, where humans supply intent and judgement rather than executing steps — and where the factory itself is engineered, measured and improved as a product.",
    },
    {
      title: "The five commitments",
      text: "<b>C1 — the oracle comes first.</b> The acceptance criteria become a checkable oracle during specification, before any implementation runs, authored against the spec rather than the code. An agent may propose extra tests; it may never write the tests that decide its own change. Everything else in the blueprint follows from this one decision.",
    },
    {
      title: "Watch one task run",
      text: "Open <b>Live simulation</b> and press auto-run. One issue travels through twelve stages — and you can watch it move between trust zones. Stage 4 (the oracle) and stage 9 (verification in a fresh container) are the ones that make the safety story structural rather than aspirational.",
    },
    {
      title: "The architecture map",
      text: "Six trust zones, from the human (Z0) down to untrusted code in a container (Z3) and out to third parties (Z4). <b>The severed red lines are the point</b> — the data plane has no database role, no secret, no docker socket, and no route out except an allow-listed proxy. Click any component to see what it may and may not do.",
    },
    {
      title: "Where authority lives",
      text: "<b>C2 — the control plane holds the state; the data plane does the work.</b> There is no path from an agent to an effect that bypasses a policy decision, because no such path exists. That is topological, not aspirational — any safety story resting on the agent choosing well is not a safety story.",
    },
    {
      title: "The dials",
      text: "Four independent dials: autonomy <b>L0–L4</b> (default L2), blast radius <b>R0–R4</b>, isolation <b>T1–T3</b>, and effect class <b>E0–E4</b>. A task can be highly capable in one dimension and absolutely locked down in another — and that separation is the design.",
    },
    {
      title: "The guarantees",
      text: "Twelve invariants and fifteen red-team attacks, each with its defence. If the same agent writes the fix and the test that judges it, the gate measures the agent agreeing with itself. The defence is <b>authorship flags and oracle admission</b> — not trust in the model.",
    },
    {
      title: "The eight weeks",
      text: "One owner, one repo, one workflow first. W0 scaffolds and starts the manual factory; W2 exits Phase 0 (an unauthorised call is denied and logged); <b>W5 delivers the first real issue</b>; W8 is production readiness. Every phase has a gate with checklist rows that may never be waived.",
    },
    {
      title: "The measurement discipline",
      text: "Every change reports <b>Baseline, Delta, Cost, Guardrail</b>. Cost is attributed to the accepted change. And: <b>no corpus figure is a target</b> — the factory measures itself and reports honestly, including when unflattering.",
    },
    {
      title: "What is actually covered",
      text: "<b>Coverage</b> holds the requirement matrix — 79 requirements and the ticket that proves each one — plus the invariant test inventory, the deferral register (every cut, with the trigger that reverses it) and the Friday checkpoint. It is the honest answer to “how much of this exists?”",
    },
    {
      title: "Where the documents disagree",
      text: "<b>Consistency</b> names the seven places the source documents contradict each other — 19 states versus 20, six workflows versus seven, two different uses of the <code>I-</code> and <code>R-</code> prefixes — and states which reading this visualizer uses. Read it once and the rest stops being confusing.",
    },
    {
      title: "What an agent knows",
      text: "<b>Context & memory</b> opens the machine behind commitment C3. Watch the assembler run: policy, then selection, then precedence, then trust, then order, then defer, then the budget check. <b>The budget fails rather than truncating</b> — because a silently truncated context produces confidently wrong output.",
    },
    {
      title: "What you would actually write",
      text: "<b>Authoring templates</b> holds the six contracts — ADR, agent spec, workflow, skill spec, MCP integration and experiment report — with their authoring rules and review checklists. Each one says when to use it and who reviews it. <b>An experiment report is not a decision</b>: it is evidence that accompanies a proposal.",
    },
    {
      title: "How the factory knows it worked",
      text: "<b>Quality & verification</b> holds the seven test layers and, more importantly, who is allowed to write each one — the acceptance oracle is authored against the spec, never by the run that produced the code. <b>A passing suite without a passing oracle does not merge.</b> Then watch the calibration loop: a verifier that has never been shown to fail on a real violation may not gate anything.",
    },
    {
      title: "Now go explore",
      text: "Press <b>/</b> to search every component, invariant, ticket, ADR and glossary term at once. <b>Every ID in the prose is a link</b> — click <code>ADR-0004</code> or <code>I-4</code> anywhere and it jumps to that record. <b>Data model</b> shows the 21 tables and, more importantly, the capabilities that deliberately do not exist.",
    },
  ]);
}
