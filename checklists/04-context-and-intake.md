# 04 — Context, skills, prompts and intake

> **Phase W3 (5 days) · Tickets T-2.01 … T-2.08**
>
> This phase gives the factory **its memory and its front door**. The context assembler
> decides *what an agent knows at the moment it acts*; the prompt builder decides *how it
> is told*; GitHub intake decides *what is allowed to become an intent at all*.
>
> Two of the most important invariants live here: **CX-1…CX-9** (context) and **I-6 /
> I-8** (untrusted content never becomes instruction; every run's context is pinned and
> recoverable).

---

## PREREQUISITES

* Checklist 03 complete. G1 green. The orchestrator, gateway, broker, artefact store
  and context-envelope persistence points exist.
* S-2 done — T-2.04 (GitHub intake) depends on its confirmed webhook/check-run facts.

---

## STAGE 0 — Oracles

| Ticket | Oracle highlights | Route |
|---|---|---|
| T-2.01 | golden-file determinism; over-budget ⇒ `context.budget_exceeded`; untrusted content is last and delimiter/nonce spoofing is neutralised; a dependent stage gets the upstream artefact **only**; a tampered item is rejected on load | R-G |
| T-2.02 | a non-ACTIVE skill is not resolvable; a tampered skill is rejected; a lint rule: **a skill cannot declare tools or authority** | R-G |
| T-2.03 | snapshot tests per role; the authority list **denies first**; the untrusted envelope is last; numeric budgets are present; identical inputs ⇒ identical hash | R-G |
| T-2.04 | a bad signature ⇒ `webhook.rejected`; a replayed delivery is ignored; a non-allow-listed author ⇒ `intent.rejected`; the issue body is stored as an **untrusted object ref** (never inlined into instruction-bearing fields); edits after intake are ignored; a fake GitHub server in tests + one real smoke on the sandbox repo | R-G |
| T-2.05 | schema-valid; out-of-scope ⇒ REJECTED; **no tools in the prompt**; the untrusted envelope is used | R-G |
| T-2.06 | no checkable criterion ⇒ ESCALATED; every criterion has an id; vagueness heuristics flag; the spec hash is stable | R-G |
| T-2.07 | **the oracle is authored before the implementation** (provenance check); every criterion has ≥1 check; an `expectedBefore` mismatch ⇒ `oracle.admissionFailed`; an agent-route oracle is `untrusted` until approved; **`implementationRunId != null` ⇒ rejected**; generator determinism | R-G |
| T-2.08 | a cyclic graph is rejected; fan-out without justification is rejected; a node without an oracle is rejected; a capability outside the grant is rejected | R-G |

> **T-2.07 is the most important oracle in this phase.** Its job is to *refuse* oracles
> that are not independent. The `implementationRunId == null` check (A1.2) and the
> `expectedBefore` admission check are what stop a bad oracle from entering the system
> at all — the merge gate downstream can only be as good as the oracle it is given.

---

## STAGE 1 — The work

### T-2.01 · Context assembler · W3 · L · R3

**Open ONLY:** blueprint `10` §2–5, pack `02` §4.10.

**Build** `packages/context/assembler` (**pure**), a content-addressed item store,
precedence, ordering, the byte budget (**fail, never truncate**), the untrusted envelope
with a nonce, gaps, and `context_envelopes` persistence.

**`resolve(stageSpec, taskInputs, repoScope)` is a pure function** over a
content-addressed item store:

1. select by scope
2. apply precedence — **central security policy > repo-local > central context > general
   policy** — and **record gaps**
3. order
4. enforce the **byte budget** — over budget ⇒ **fail** with `context.budget_exceeded`.
   **Never silently truncate.**
5. compute `resolvedContextSha256`
6. return the `ContextEnvelope`

Same inputs ⇒ same envelope (golden-file tests; A0.4, A1.10).

**Ordering** (blueprint `10` §5.7), exactly:
**policy → acceptance criteria + oracle summary → standards → procedures → repo-local
context → reference (repo map) → untrusted envelope last.**

**The untrusted envelope format** [PACK]: each untrusted item is wrapped as

```
<<<UNTRUSTED id=… source=… nonce=…>>> … <<<END nonce=…>>>
```

with a **fresh random nonce**; any occurrence of the delimiter or the nonce inside the
content is neutralised. The prompt states the rules once — defence in depth only; the
real controls are tagging, the policy re-check and human visibility.

**Repo-local context sources in v1:** `AGENTS.md` / `CLAUDE.md` and `.factory/context/*.md`
in the target repo **at the base SHA** (privileged ⇒ changes to them are R3). The
**reference** is a deterministic repo map (tree + selected file heads), **not retrieval**.

> The context rule (blueprint `17` §5.2): *a stage receives its own specification, its
> own inputs, and — for a dependent edge — the upstream artefact. It never receives a
> sibling's context, a predecessor's transcript, or the full task graph.*
>
> And: **if the assembled context exceeds the budget, the stage fails.** Silent
> truncation produces confident wrong output — the exact failure this system exists to
> prevent.

---

### T-2.02 · Skill registry · W3 · M · R2

**Open ONLY:** blueprint `10` §4.

**Build:** the loader for `definition/skills`, the schema, procedure vs standard, the
lifecycle (**only ACTIVE is resolvable**), and integrity checking.

**"Derive, don't inject":** never paste what an agent can deterministically read.

---

### T-2.03 · Prompt builder · W3 · M · R2

**Open ONLY:** blueprint `10` §8, blueprint `08` §2.

**Build:** the ten-part builder, versioned templates (`definition/prompts`),
`promptSha256`, and per-role output contracts from Zod.

**The ten parts** (in order):

1. role
2. authority — **deny-first**
3. acceptance
4. trust rules
5. context
6. task + non-goals
7. procedure
8. numeric budgets
9. output contract
10. untrusted envelope

Prompts are **versioned artefacts** and their hash is stored.

---

### T-2.04 · GitHub intake (webhooks, ingest, tagging) · W3 · L · R3

**Open ONLY:** pack `04` §2 + §4, blueprint `13` §1.4, blueprint `12` §3.2.

**Build** `packages/scm-github`: webhook verification + dedupe, `github.*` capabilities
via the broker, the requester allow-list + permission check, the repo allow-list, ingest
**with tagging**, and a polling fallback flag.

**The tagging is the security control, not a metadata field.** The issue body is stored
as an **untrusted object ref** — it is never inlined into an instruction-bearing field.
Edits after intake are ignored (the intent is a snapshot).

---

### T-2.05 · Triage stage · W3 · S · R2

**Open ONLY:** blueprint `08` §2 role 1.

**Build:** a completion executor (cheap route) and the schema `{workflow, inScope, rationale}`.
**No tools in the prompt.**

---

### T-2.06 · Refinement stage and spec schema · W3 · M · R2

**Open ONLY:** blueprint `12` §3, blueprint `08` §2 role 2.

**Build:** the `specify` stage and the spec schema — goal, non-goals, acceptance criteria
with ids + checkable-kind hints, constraints, `public-interface` tags, open questions.
Guard `TRIAGED→REFINED`.

**No checkable criterion ⇒ ESCALATED.** Vague criteria are flagged by heuristics, not
silently accepted.

---

### T-2.07 · Oracle construction and admission · W3–W4 · L · R3

**Open ONLY:** blueprint `14` §3, blueprint ADR-0005, pack `02` §4.14.

**Build** `packages/oracle`: the manifest, the three routes (R-H / R-G / R-A), the
generators (`command-check`, `cli-golden`, `behavior-table`, `file-assertion`), the
protected-path writer, admission (a before-state run in T2), and provenance.

**Model:** criteria → checks; each check has `kind`, files, `expectedBefore (fail|pass)`,
`visibility (visible|holdout)`; provenance `{route, author, implementationRunId (must be
null), commitSha/hash}`.

**Admission** runs before the plan-approval request and is **re-checked at
`PLANNED → QUEUED`**: run the oracle in T2 at the base SHA; compare each check to
`expectedBefore`; a mismatch ⇒ `oracle.admissionFailed` (R-A regenerates once; R-G
escalates as a generator bug; R-H goes back to the owner). Admission also checks that
every acceptance criterion has ≥1 check (A1.3) and `implementationRunId == null` (A1.2).

---

### T-2.08 · Planner stage and graph admission · W3–W4 · M · R3

**Open ONLY:** blueprint `09` §7, blueprint `08` §2 role 4, pack `03` §4.11.

**Build:** the `plan` stage, the `TaskGraph` schema, and admission — acyclic, an
`oracleRef` per node, the **4 chunkability conditions** for fan-out, and
`grants ⊆ workflow`.

---

## STAGE 2 — Review

Standard reviewer pass. T-2.01, T-2.04 and T-2.07 are **R3**; T-2.07's oracle is
owner-approved at the plan approval (R-A route), because an agent-authored oracle is
`untrusted` until a human says so.

---

## GATE ROWS

No gate closes here, but these G2 rows are **created** by this phase and closed in
checklist 05:

| Row (closed later) | Statement | Closed in |
|---|---|---|
| CL-G2-04 | **A1.4** context within budget on every run; no silent truncation | checklist 05 (T-2.13) |
| CL-G2-05 | **A1.5** a dependent stage gets the upstream artefact and nothing else | checklist 05 (T-2.13) |
| CL-G2-02 🔒 | **A1.2** the oracle is authored before the implementation runs | checklist 05 (T-2.17) |
| CL-G2-03 | **A1.3** every acceptance criterion has ≥1 oracle check | checklist 05 (T-2.17) |
| CL-G2-06 🔒 | **A1.6** agent-authored tests are flagged untrusted and never alone satisfy a criterion | checklist 05 (T-2.13) |
| CL-G2-10 | **A1.10** context resolution reproducible (golden file) | checklist 05 (T-2.19) |

---

## EXIT CRITERIA — before checklist 05

- [ ] `resolve()` is pure; golden files prove determinism.
- [ ] Over-budget context ⇒ `context.budget_exceeded`, **never** a truncated envelope.
- [ ] The untrusted envelope is **last** in every rendered prompt; delimiter and nonce
      spoofing is neutralised.
- [ ] A dependent stage receives the upstream artefact **and nothing else**.
- [ ] A tampered context item is rejected on load.
- [ ] Only ACTIVE skills resolve; a skill declaring tools or authority fails lint.
- [ ] The ten-part prompt is built in order; authority denies first; the envelope is last.
- [ ] A bad webhook signature ⇒ `webhook.rejected`; a replayed delivery is ignored.
- [ ] A non-allow-listed author ⇒ `intent.rejected`.
- [ ] The issue body is stored as an untrusted **object ref**, never inlined.
- [ ] No checkable criterion ⇒ ESCALATED.
- [ ] An oracle with `implementationRunId != null` is **rejected**; an `expectedBefore`
      mismatch ⇒ `oracle.admissionFailed`.
- [ ] A cyclic graph, unjustified fan-out, oracle-less node and out-of-grant capability
      are each rejected.

---

## TRAPS

1. **Truncating the context to fit the budget.** The single most consequential shortcut
   in the whole blueprint. `context.budget_exceeded` is the correct outcome. Truncation
   produces confident wrong output.
2. **Putting the untrusted envelope before the standards** "because the task is more
   important". Ordering is a security control. The envelope is **last**, always.
3. **Reusing the delimiter string without a per-item nonce.** Then untrusted content can
   forge an envelope boundary. The nonce is randomised per item and any occurrence
   inside the content is neutralised.
4. **Inlining the issue body into the task prompt.** It becomes instruction. It is
   stored as an untrusted object reference and reaches the agent only inside the
   envelope.
5. **Letting the implementer write its own oracle** because "it knows the code best".
   That is exactly the failure I-10 forbids. The oracle author must not see the
   implementation, and the implementer may not edit the oracle (HR-2).
6. **Accepting a spec whose criteria cannot be checked.** "Make it more robust" is not
   a criterion. No checkable criterion ⇒ ESCALATED, which is a **correct outcome, not a
   failure**.
7. **Using retrieval for the repo map.** The reference context is a deterministic repo
   map (tree + selected file heads). Vector retrieval as the context store is on the
   must-not-build list.
8. **Writing a skill that declares tools.** A skill is a procedure or a standard. If it
   needs a tool, it needs a grant, and grants live in the definition — not in a prompt
   file.
