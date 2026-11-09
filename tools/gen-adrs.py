#!/usr/bin/env python3
"""Generate the pack's ADR set (ADR-0013 .. ADR-0027) with owner confirmation.

Each ADR records one row of the pack's decision register (pack `01` §6). The pack is
read-only, so the ADRs live here, in the factory repo, as the owner-side record of
those decisions. Run once; edit the files afterwards, not this script.
"""

import os

OUT = 'docs/adr'
os.makedirs(OUT, exist_ok=True)

HEADER = """# ADR-{num} — {title}

- **Status:** {status}
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** {supersedes}

---

## Context

{context}

## Decision

{decision}

### Scope limits

{scope}

## Consequences

**Positive**
{positive}

**Negative**
{negative}

**Neutral**
{neutral}

## Alternatives considered

| Alternative | Why rejected |
|---|---|
{alternatives}

## Validation

- {valid1}
- {valid2}

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-{num})
- Related: {related}
"""


def write(num, slug, title, status, supersedes, context, decision, scope,
          positive, negative, neutral, alternatives, valid1, valid2, related):
    body = HEADER.format(
        num=num, title=title, status=status, supersedes=supersedes,
        context=context.strip(), decision=decision.strip(), scope=scope.strip(),
        positive='\n'.join('- ' + p for p in positive),
        negative='\n'.join('- ' + n for n in negative),
        neutral='\n'.join('- ' + n for n in neutral),
        alternatives='\n'.join('| ' + a + ' | ' + r + ' |' for a, r in alternatives),
        valid1=valid1, valid2=valid2, related=related)
    path = os.path.join(OUT, num + '-' + slug + '.md')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(body)
    print('wrote', path)


write(
    '0013', 'stack', 'Build the factory on the TypeScript profile', 'Accepted', 'none',
    """
The factory touches four surfaces at once — an access-point API, a worker, a CLI and a dashboard —
and it must be reviewed line by line by one person. The pack's decision register names a **reference
profile** rather than a fixed language, because "the language you review fastest" is a fact about the
owner, not about the project. Until the owner answers D2, the reference profile is the only thing that
lets the checklist paths be written down at all.

The corpus is explicit that the choice is a *profile*: Python (FastAPI/Pydantic) is equally valid and
only the paths in the tickets change. What does **not** change is the contract source of truth, the
dependency rules, the task surface, or any of the security properties.
""",
    """
The factory uses the **TypeScript profile** (strict) on the current Node LTS, with pnpm workspaces.

| Concern | Choice |
|---|---|
| Language / runtime | TypeScript (strict) on Node LTS, `NodeNext` module resolution |
| Package manager / layout | pnpm workspaces, one package per bounded concern, per pack `02` §3 |
| Test runner | Vitest, with fast-check for property tests |
| Contract source of truth | **Zod** schemas, exported to JSON Schema |
| Migrations | SQL-first, applied by a migration runner; Kysely for typed queries |
| HTTP | Fastify with a Zod type provider; OpenAPI generated from the schemas |
| Dashboard | React + Vite |
| CLIs | `execa` (argv arrays only — never shell strings) |
| Observability | pino + prom-client |

This ADR **confirms** the pack's ADR-0013: the pack already names the TypeScript reference profile and
the owner has not selected an alternative. The record exists so a later reader can see the choice was
made rather than inherited.
""",
    """
This ADR does not settle the D2 alternative (the Python profile) — that path exists and is documented in
`A1` §5, and re-targeting it changes only paths and task names, not contracts or security properties.
It does not settle the version pins of individual dependencies; those are locked by the lockfile and
changed through ordinary dependency review.
""",
    ["One language across API, worker, CLI and UI reduces the review surface for a solo owner, and gives "
     "strong runtime and static typing for a contract-heavy codebase.",
     "Vitest with fast-check covers example-based and property-based testing in one runner, which matters "
     "because the invariant suite depends on property tests.",
     "`execa` with argv arrays makes the 'never shell strings' rule (AGENTS.md §4) mechanically checkable "
     "rather than a code-review habit."],
    ["The dashboard and the worker share a type system, so a contract change breaks the UI at compile "
     "time. That is a cost paid on every contract edit, and it is the price of the single-language choice.",
     "Zod is a runtime dependency in the trust-critical path: a schema is executable code, and a bug in a "
     "schema is a bug in the policy that decides whether a change is allowed.",
     "Node is a high-churn runtime. 'Current Node LTS' means the pin moves over time, and each move is a "
     "chance for a behavioural difference in the event loop or the stream handling the factory depends on."],
    ["The task surface is language-neutral (`just` recipes over canonical task names), so the choice is "
     "recorded once and the checklists carry no stack-specific syntax.",
     "The dependency rules (pack `02` §3) are enforced by dependency-cruiser, which understands the "
     "TypeScript project references used here."],
    [("Python with FastAPI and Pydantic",
      "Equally valid, and the better choice if the target repos are Python-centric and the owner reviews "
      "Python faster. Not rejected on merit — deferred until D2 is answered; the re-targeting procedure "
      "in `A1` §5 exists precisely for this."),
     ("Go or Rust for the control plane",
      "A stronger type system at the cost of a second language for the dashboard, and a much slower "
      "review-and-iterate loop for a solo owner inside an 8-week plan."),
     ("A mixed polyglot repository",
      "Would multiply the review surface exactly where the plan has the least slack.")],
    "`docs/stack-profile.md` exists and names this profile; `pnpm run ci` runs green on the scaffold.",
    "If the owner answers D2 with Python, this ADR is superseded and `A1` §5 is executed — the paths "
    "change, the contracts and the security properties do not.",
    "ADR-0026 (command surface), ADR-0014 (definition location)",
)

write(
    '0014', 'definition-location', 'Keep the factory definition in the factory monorepo', 'Accepted',
    'none',
    """
The factory's *definition* — the workflows, roles, capabilities, grants, environments, criticality map
and repository allow-list that make the factory a declarative system rather than a codebase (blueprint
ADR-0001) — has to live somewhere. The alternatives are a second repository, or inside the factory
monorepo.

The corpus constrains the choice more than it drives it: the definition is applied by version, and the
applied version is a merged git SHA. A definition living in the monorepo therefore needs no separate
release process, and a change to it is reviewed by the same mechanism as a change to anything else.
""",
    """
The factory definition lives at `/definition` in the factory monorepo.

It is protected by CODEOWNERS (owner approval required) and by a path-deny for agent runs. The applied
version is the **merged git SHA** of the definition at the time of application — not a branch name, not
a tag, and not a mutable pointer.
""",
    """
This ADR does not decide how the definition is *authored* (a future profile may add a DSL and a
compiler), nor how it is *applied* to a target repository (T-1.06, the definition store and applier).
It does not decide the read model used to audit a past run.
""",
    ["One repository means one review mechanism, one set of branch protections and one commit history "
     "for both the definition and the code that applies it.",
     "Versioning by merged SHA makes every applied definition trivially reproducible: the SHA is the "
     "version, and `git show` reconstructs it.",
     "A solo owner maintains one repository rather than two, which is the constraint the pack's "
     "8-week plan is built around."],
    ["The definition and the runtime change in the same pull request, so a definition change is coupled "
     "to a code change. A purely declarative change therefore pulls a runtime change along with it.",
     "As the definition grows, `definition/**` becomes a large share of the repository and a frequent "
     "source of review load.",
     "Because the definition is in the same repo as the applier, a bug in the applier can corrupt the "
     "definition it reads. The applied-SHA discipline limits, but does not remove, this coupling."],
    ["The path `/definition` is on the R4 human-only list, so an agent run cannot modify it even when a "
     "ticket appears to ask for it."],
    [("A separate definition repository",
      "Cleaner separation, but it introduces a second repository, a second set of protections and a "
      "cross-repository versioning scheme — cost the plan does not need while there is one owner."),
     ("The definition inside each target repository",
      "Moves the trust boundary into repos the factory does not control, and would make the factory's own "
      "governance un-auditable from one place."),
     ("A database-backed definition store",
      "Makes the definition mutable without a commit, which breaks the applied-version-is-a-SHA property "
      "that the audit trail depends on.")],
    "Every applied-definition event records the merged SHA, and `git show <sha>` reconstructs the exact "
    "definition that was applied.",
    "If a second human joins, or if the factory begins targeting its own `definition/**`, the "
    "separation-of-repository argument becomes stronger than the single-owner argument and this ADR "
    "must be revisited.",
    "ADR-0013 (stack), ADR-0015 (bootstrap)",
)

write(
    '0015', 'bootstrap', 'Bootstrap the factory by hand, then let it take over its own non-critical work',
    'Accepted', 'none',
    """
A factory that is built by a factory that does not yet exist is a bootstrap problem. The pack resolves
it by splitting the timeline: W0–W4 the factory's own tickets are executed by **humans following a
written manual protocol**, and from W5 the factory takes non-critical tickets on its own repository.

The alternative — building the automation first and only then using it — has the property that the
automation is never exercised against real work, so its bugs are found late and expensively. The
manual-first order means the protocol is written down and proven by hand before anything depends on it.
""",
    """
The factory is bootstrapped as a **manual factory**.

1. **W0–W4.** Every ticket is executed by a human (or an AI agent run by a human) following `AGENTS.md`
   and the protocol in pack `07` §3: worktree, context bundle, oracle first, implement, self-review,
   PR from the template.
2. **From W5.** The factory takes **non-critical** tickets on its own repository.
3. **Always human-only, at every tier:** `definition/**`, `migrations/**`,
   `packages/{policy,broker,credentials}/**` and `.github/**` remain R4.

The manual factory is not a throwaway. It is the same loop the factory will run, executed by a human,
which is why the manual artefacts (AGENTS.md, the ticket template, the PR template, the worktree helper,
the context bundler and the two guards) are built in W0 and are the same artefacts the automation uses.
""",
    """
This ADR does not decide the promotion criteria from manual to automated, nor the L1/L2/L3 promotion
mechanics — those are the path to peak automation (`A2`) and are decided ticket by ticket. It does not
decide which target repositories are eligible for factory-run tickets.
""",
    ["The protocol is exercised against real tickets from day one, so its failure modes surface while "
     "the cost of a mistake is still low.",
     "The manual artefacts double as the automation's inputs: the same context bundler, the same guards "
     "and the same PR template serve both the human and the machine path.",
     "Productivity begins at week one rather than after the automation is built."],
    ["Everything before W5 is slower than an automated run, and the 8-week plan's throughput assumption "
     "depends on the automation arriving on time.",
     "The manual protocol is a document, not code — it can be followed incorrectly, and there is no "
     "machine check that the human followed it.",
     "The W5 hand-over point is a discontinuity: work that ran one way before will run another way "
     "after, and the transition is a fault-isolation problem as much as a scheduling one."],
    ["The R4 paths are the same in both modes, so the human review floor does not move when the "
     "automation arrives."],
    [("Build the automation first, then use it on real work",
      "The automation would never meet real work until late in the project, and its defects would be "
      "found in the most expensive phase of the plan."),
     ("Outsource the bootstrap to a contractor",
      "The bootstrap decisions are exactly the ones the owner must own, and the corpus's whole "
      "argument is about keeping the authority split intact."),
     ("Skip the manual phase and run everything by hand informally",
      "An informal protocol is not reviewable and produces no artefacts for the automation to inherit.")],
    "The W0 manual artefacts (`AGENTS.md`, the ticket template, the PR template, the worktree helper, the "
    "context bundler, both guards) exist and are exercised by real tickets.",
    "If the manual phase cannot produce the artefacts the automation needs, the automation's design "
    "assumption is wrong and must be revisited before W5, not after.",
    "ADR-0014 (definition location), ADR-0016 (merge model)",
)

write(
    '0016', 'merge-model', 'Humans merge in the GitHub UI; the factory holds no merge capability in v1',
    'Accepted', 'none',
    """
The blueprint's autonomy ladder (L0–L3) says the merge decision is the owner's until promotion is
earned, and the pack's L2 model is the first level where the factory proposes changes to itself but
never applies them. The question this ADR answers is the mechanism, and the mechanism is what makes the
authority split checkable rather than aspirational.

If the factory can merge, then every guarantee about human control is enforced by the factory's own
code — the same code that makes the proposal. Keeping the merge outside the factory makes the
guarantee structural.
""",
    """
In v1 the factory **never merges**.

1. Humans merge in the GitHub UI.
2. The factory holds **no merge capability**: there is no capability that merges a branch, and no
   credential that would permit it.
3. Approval is a commit status / check bound to the **head SHA**, not to the branch name.
4. The factory observes `pull_request.closed` with `merged: true` and records a `change.merged` event
   naming the human as the authority.
""",
    """
This ADR does not decide the L3 promotion criteria, and it does not forbid the factory from *opening* a
pull request — it decides who merges. It does not decide how the approval check is bound in GitHub's
ruleset, which is `tools/protect-repo` and an owner-applied configuration.
""",
    ["The human review floor (blueprint ADR-0003) is enforced by the absence of a capability rather than "
     "by a policy check that could be disabled or misconfigured.",
     "The check binds to the head SHA, so a force-push after approval invalidates the approval rather "
     "than silently carrying it forward.",
     "The factory still learns from merges — the `change.merged` event is what the measurement layer "
     "consumes — without holding the authority."],
    ["Every merge waits on a human sitting at a browser, which bounds throughput by the owner's review "
     "capacity (D10, 2–3 h per day) regardless of how fast the factory proposes.",
     "The factory cannot self-merge even when it is right, so a perfectly-correct proposal still "
     "consumes owner attention.",
     "Observing `pull_request.closed` means the merge is a *fact learned after the fact*, not a step "
     "the factory controls — which is the point, but it means the factory cannot correct a mistaken "
     "merge."],
    ["The factory's own proposals to change itself are subject to exactly the same rule as everyone "
     "else's — which is what 'the factory proposes changes to itself and never applies them' means in "
     "practice."],
    [("Give the factory a merge capability, gated by an L2 promotion",
      "The corpus does not forbid it — it forbids it *in v1*. Adopting it now would put the "
      "human-control guarantee behind the factory's own implementation."),
     ("Let the factory open a pull request with a pre-filled merge checkbox",
      "GitHub does not offer this safely, and any approximation would amount to a merge capability with "
      "extra steps."),
     ("The factory merges via the GitHub App's merge permission",
      "That is a merge capability, and it is also the permission that would make a credential leak "
      "immediately destructive.")],
    "No capability in the registry performs a merge, and the GitHub App permissions in ADR-0018 do not "
    "include anything that would permit one.",
    "If the owner promotes to L3, this ADR is superseded by a new one that names the capability, the "
    "gate and the rollback path — it is not amended in place.",
    "ADR-0018 (credentials), ADR-0024 (notifications and approvals)",
)

write(
    '0017', 'executor-kinds', 'Two executor kinds, and only the Worker uses the harness',
    'Accepted', 'none',
    """
Some stages of a workflow need to *reason* and some need to *act on a codebase*. An earlier design
implicitly treated both as "call a model". That conflates a small, bounded reasoning step with an
agent that can read and write arbitrary files, and it widens the attack surface of every workflow.

The pack's decision narrows this to two executor kinds and, more importantly, restricts *which stage*
may use the powerful one.
""",
    """
There are **two** executor kinds.

| Kind | What it is | Who may use it |
|---|---|---|
| `completion` | a single structured model call through the gateway | Refinement, Planner, Triage, Reviewer, Security-Reviewer |
| `harness` | a coding agent inside the T2 sandbox | the **Worker**, and Workflow-D / C fixers only |

Every model call goes through the gateway. There is no third kind, and no stage may use the `harness`
because it happens to find it convenient — the set of harness-eligible stages is part of the definition,
and the definition is owner-owned (ADR-0014).
""",
    """
This ADR does not decide whether a read-only tool loop should be permitted for stages that need to
explore a repository beyond the assembled context — the pack records that as a revisit trigger. It does
not decide which model a completion uses (that is ADR-0023, configuration only).
""",
    ["The attack surface of the dangerous executor is bounded to the one stage that genuinely needs "
     "code execution.",
     "The `completion` kind is cheap, fast and deterministic in shape — a single structured call is far "
     "easier to review than an agent loop.",
     "Provider portability: a completion is a plain API call and moves between providers trivially."],
    ["A stage that outgrows a single structured call has no path forward other than escalation. The "
     "Planner and Reviewer will eventually need repo exploration that a single call cannot provide.",
     "The boundary is a policy that must be enforced at the definition level, not a type — a "
     "misconfigured workflow could try to use `harness` for a Reviewer unless the registry checks it.",
     "Restricting stages keeps the agent-run count low, which is good for the budget but means a "
     "workflow that would benefit from parallel exploration cannot have it."],
    ["The executor kind is a property of the workflow definition, so it is visible in the same place "
     "as every other definition change and is reviewed the same way."],
    [("One executor kind (harness everywhere)",
      "Maximally uniform, and it makes every stage as dangerous as the most dangerous one — the "
      "reviewer's ability to reason about a stage collapses."),
     ("One executor kind (completion everywhere)",
      "The Worker cannot implement a change at all, so the factory cannot build software."),
     ("Per-stage executor kinds chosen freely by the workflow author",
      "That is an unreviewed widening of the attack surface expressed as a convenience.")],
    "The capability registry rejects a workflow that requests the `harness` kind for a stage outside the "
    "permitted set, and the route-inventory test covers it.",
    "If more than one stage genuinely needs repository exploration, the revisit trigger fires and a new "
    "bounded read-only loop kind is designed rather than widening `harness`.",
    "ADR-0020 (isolation), ADR-0023 (routing)",
)

write(
    '0018', 'credentials', 'Use a GitHub App with per-task installation tokens; no PATs', 'Accepted',
    'none',
    """
The factory acts on a real repository with real write permissions, so its credentials are the highest-
value secret in the system and the most attractive to leak. The corpus is unambiguous about the
failure it must prevent: a credential that lives longer than the task and is broader than the task is
a standing capability for whoever obtains it.

The pack also names the consequence of getting this wrong in one sentence — a leaked App credential
can rewrite a repository's CI, which is how a compromise becomes a supply-chain event.
""",
    """
Credentials are a **GitHub App** with **per-task installation tokens**.

1. No PATs. No long-lived tokens of any kind.
2. A token is minted per task, **narrowed to the single repository** and to the **minimum permissions
   for that stage** (`contents:read` for read-only stages; write permissions only where the stage
   writes).
3. The token lives inside the broker step that uses it. `git push` authenticates via `GIT_ASKPASS`
   reading a one-shot environment variable — the token never appears in argv, in a URL, in logs or in
   events.
4. At the terminal state (and by the reaper), the token is revoked via
   `DELETE /installation/token` and the lease is marked revoked.
5. Human login is via GitHub OAuth with an owner allow-list.
""",
    """
This ADR does not decide the App's exact permission set — that is recorded in ADR-0018's companion
note in `docs/stack-profile.md` and in the checklist's T-0.01 row, and it is verified against GitHub's
current App settings by spike S-2. It does not decide the secret *storage* mechanism (that is D8 /
ADR-0025's sops+age).
""",
    ["A leaked token expires with the task, so the blast radius of a leak is one task on one repository "
     "rather than the whole account.",
     "Narrowing permissions per stage means a read-only stage physically cannot push, even if it were "
     "compromised.",
     "The token never enters argv or logs, so the ordinary log-scrubbing path cannot miss it."],
    ["Token minting adds a round trip to every task, and a token that expires mid-task must be "
     "re-minted — a failure mode that is invisible until it bites.",
     "A revoked token cannot be used to audit what happened during the task, so forensic questions "
     "about a completed task cannot be answered with the credential.",
     "The App must be installed on the target repository by the owner, which is a manual step that "
     "blocks the first automated run."],
    ["The `GIT_ASKPASS` mechanism is standard git behaviour, so it does not require a custom git "
     "wrapper."],
    [("Personal access tokens",
      "Long-lived, broad, and the credential type that turns any leak into a repository compromise. "
      "Explicitly rejected."),
     ("A single long-lived App installation token",
      "Better than a PAT but still a standing credential; the per-task narrowing is the whole point of "
      "the design."),
     ("OAuth user tokens for the agent",
      "Would grant the agent the owner's authority, collapsing the separation between the factory and "
      "the person reviewing it."),
     ("Short-lived OIDC tokens from a CI provider",
      "Viable where the CI provider is trusted, but it couples the factory's trust path to that "
      "provider and complicates the local-development path.")],
    "The capability registry contains no credential that outlives a task, and the integration test "
    "proves a token is revoked at the terminal state.",
    "If the owner needs the factory to run unattended for longer than a token lifetime and re-minting "
    "proves unreliable, this ADR is revisited rather than the token lifetime quietly extended.",
    "ADR-0016 (merge model), ADR-0025 (hosting and secrets)",
)

write(
    '0019', 'event-sequencing', 'Use a gapless counter sequence under a row lock, not a bigserial',
    'Accepted', 'none',
    """
The factory's audit trail is the substrate for every replay, every metric and every invariant that
checks "what happened". If events can be lost, reordered or skipped, then a projector reading by
sequence can silently miss events, and the factory will report a confident, wrong history.

The pack identifies the specific trap: a plain `bigserial` leaves gaps on rollback and can commit out
of order, which produces false "lost write" alarms and skipped events in cursor-based projectors. The
failure is not a rare race — it is the normal behaviour of the obvious implementation.
""",
    """
Event ordering uses a **gapless `seq`** taken from a counter row updated under a row lock, so the
sequence is commit-ordered.

On top of that:

- Per-aggregate `version`, advanced with a compare-and-set on the aggregate row.
- Projectors read by `seq`, and a gap is a hard error rather than a skipped row.
- Monthly time partitions on the events table.

This ADR **clarifies** blueprint ADR-0008 (event sourcing) — it does not change it.
""",
    """
This ADR does not decide the partitioning schedule beyond "monthly", nor the projector retention
policy, nor the snapshot cadence. It does not decide the exact SQL, which is T-1.02.
""",
    ['A gapless sequence makes "an event is missing" a detectable condition instead of an '
     "undetectable one. The distinction is the difference between a projector that fails loudly and a "
     "projector that quietly produces a wrong history.",
     "Commit-ordering means the sequence reflects reality, not just allocation order.",
     "The per-aggregate version CAS gives optimistic concurrency on aggregate state without holding a "
     "lock across the whole transaction."],
    ["A counter row under a row lock serialises event appends. At high write rates this is the "
     "bottleneck — the pack names p95 append above 50 ms or 200 events/s sustained as the revisit "
     "trigger, and that trigger will fire under real load.",
     "The lock adds contention against other writers to the same counter, including administrative "
     "operations that have nothing to do with the factory's event stream.",
     "Gapless sequencing costs more than `bigserial` on every append; that is the price of "
     "detectability."],
    ["The append pattern is documented in blueprint `09_ORCHESTRATION_STATE_AND_EVENTS.md`, so the "
     "ordering contract is readable independently of the implementation."],
    [("A plain `bigserial` column",
      "The obvious implementation, and the one the pack names as the trap: gaps on rollback and "
      "out-of-order commits produce false alarms and skipped events."),
     ("A database sequence with `NO CYCLE` and advisory locks",
      "Still allocates out of commit order, so the same class of failure survives."),
     ("A message broker's ordering guarantees",
      "Adds infrastructure the corpus explicitly forbids (HR-6), and its ordering guarantee is "
      "partition-scoped rather than global."),
     ("Logical timestamps instead of a sequence",
      "Clock skew and equal timestamps make ordering ambiguous; timestamps are good for correlation "
      "but not for a gapless cursor.")],
    "The DDL test proves the sequence is gapless under concurrent writers, and the event-log invariant "
    "test fails on a missing `seq`.",
    "If p95 append exceeds 50 ms or 200 events/s is sustained, the pack's own revisit trigger fires "
    "and the sequence-plus-snapshot-safe-reader design replaces this one.",
    "ADR-0008 (blueprint event sourcing), ADR-0020 (isolation)",
)

write(
    '0020', 'isolation-and-execution', 'T1 for reading, T2 rootless Docker for anything that executes code',
    'Accepted', 'none',
    """
The factory's realistic v1 threats are container escape and attacks through the host git daemon —
not a novel kernel exploit. The corpus is explicit that this is the threat model being accepted, and
that a stronger boundary (T3) is deferred behind a trigger rather than built in week one.

The consequence is a rule that is easy to state and easy to get wrong: **any stage that executes
repository code must run inside T2**, and verification counts as executing code.
""",
    """
Two isolation tiers, plus a deferred third.

**T1 — host worktree / snapshot, no code execution.** Used for read-only and `completion` stages.

**T2 — rootless Docker.** Mandatory for any stage that executes repository code, **including
verification**. The rules:

- No `docker.sock` in any container.
- **Never run host `git` inside a directory a container could write.** Extract the patch with
  `git diff --binary` and apply it to a clean host worktree.
- Per-task token-bound **egress proxy**; the container reaches the outside world only through it.
- Model access only via the gateway passthrough.

**T3 — deferred**, built on the trigger in pack `01` §3.
""",
    """
This ADR does not decide the T3 design, nor the exact egress proxy implementation (T-2.10), nor the
resource limits per stage. It does not decide whether `runsc` (gVisor) is used — the pack marks that
`[VERIFY]` and spike S-3 settles it.
""",
    ["The cheap, realistic attacks are closed: a container cannot reach the host docker daemon, and a "
     "malicious repository cannot execute a git hook or a config in the host's working tree.",
     "The egress proxy makes 'what did this task send out' answerable per task, with a token bound to "
     "it.",
     "T1 stays cheap for the many stages that only read, which keeps the common path fast."],
    ["T2 costs real wall-clock time per task — container start, image pull, filesystem setup — against "
     "a budget of ≤2 h per task.",
     "Rootless Docker has its own performance and compatibility costs, and it is not available on every "
     "host (Docker Desktop on macOS and Windows differ).",
     "The 'never run host git in a container-writable directory' rule is a discipline, not a "
     "mechanism: it can be violated by an agent that does not know the rule, and the consequence is "
     "host-level code execution.",
     "The egress proxy must be correct, and a proxy that is too strict breaks tasks while a proxy that "
     "is too loose defeats the control."],
    ["Kernel-level container escape is an **accepted risk** in v1, mitigated by rootless/userns, no "
     "capabilities, seccomp and optional gVisor."],
    [("Run everything on the host",
      "Removes all isolation. The corpus identifies container escape and git-hook attacks as the "
      "realistic v1 threats, and this option declines to address either."),
     ("Use a full VM per task",
      "Stronger isolation, materially slower, and disproportionately expensive for the many read-only "
      "stages that need none of it."),
     ("Use rootless Docker for every stage including reads",
      "Would satisfy the safety rule but pay the T2 cost on the common path, where the blast radius of "
      "a read-only stage is small."),
     ("Run verification on the host but execution in T2",
      "Verification executes repository code — the test suite is attacker-controlled — so this split "
      "leaves the most reachable hole open.")],
    "The route-inventory test asserts that no host-execution capability exists outside T1 read "
    "operations, and the container policy test asserts the no-docker.sock and no-host-git rules.",
    "If the accepted kernel-escape risk materialises, or if the threat model changes, T3 is built on the "
    "pack's trigger rather than the policy being quietly relaxed.",
    "ADR-0017 (executor kinds), ADR-0022 (blast radius)",
)

write(
    '0021', 'oracle-routes', 'Three oracle routes; an agent may not author the oracle it implements',
    'Accepted', 'none',
    """
The single most valuable property of the factory is that its verification is *independent* of the
thing it verifies. If the same agent writes the fix and the test that decides the fix is correct, the
gate measures the agent agreeing with itself — which is exactly the failure the whole blueprint is
built to avoid.

Independence has a cost: the oracle must be authored by someone (or something) that has not seen the
implementation. With a solo owner, that "someone" is expensive. The routes below buy independence at
the lowest sustainable cost.
""",
    """
There are **three oracle routes** in v1.

| Route | Who authors | Where it is trusted |
|---|---|---|
| **R-H** | a human | protected path |
| **R-G** | a deterministic generator, for a small set of criterion kinds | reproducible and reviewable |
| **R-A** | an agent, in a **separate run before the implementer** | `untrusted` until the owner approves it **inside the plan approval** |

Every criterion declares `expectedBefore: fail | pass` — `fail` for new behaviour and bug fixes,
`pass` for refactors. Admission runs the oracle on the base commit and **refuses on mismatch**, which
is what makes a criterion meaningful rather than decorative.

Criteria may be `visible` or `holdout`.
""",
    """
This ADR does not decide the criterion kinds that R-G can generate (T-0.01 and the later oracle
tickets do), nor which criteria are holdout, nor the metrics that later decide whether R-A agents may
be trusted more broadly.
""",
    ["R-G is reproducible and reviewable — the same specification always produces the same oracle, so "
     "a reviewer can re-run it and get the same answer.",
     "R-A is the only route that scales with agent throughput, and the separate-run rule preserves its "
     "independence while making it cheap.",
     "The `expectedBefore` declaration makes a criterion self-checking: a criterion that passes before "
     "the change was written was never testing the change."],
    ["R-H does not scale. Every criterion the owner must write personally is a criterion that does not "
     "get written.",
     "R-A consumes a run and a review for every criterion, so it is the most expensive route per "
     "criterion even though it is the cheapest per owner-minute.",
     "The base-commit admission run doubles the oracle's execution cost: it runs once before the "
     "change and once after.",
     "The `untrusted` status of an R-A oracle means it cannot gate a merge on its own, which will feel "
     "slow to an owner under time pressure."],
    ["The oracle's provenance records its route, so a reviewer can judge the independence rather than "
     "assume it."],
    [("One route for all oracles",
      "Any single route has a cost the plan cannot afford at one end or the other: human authoring does "
      "not scale, and agent authoring without a separate run destroys independence."),
     ("Let the implementer author its own tests, plus a human review",
      "This is the status quo the blueprint exists to replace; the gate would measure self-consistency."),
     ("Derive the oracle from the implementation",
      "Produces a test suite that passes by construction and cannot detect a misread requirement.")],
    "The oracle-independence guard rejects a PR from an implementer branch that modifies an oracle "
    "path, and the oracle's provenance record shows `implementationRunId: null` at construction.",
    "If R-H turns out to be the dominant route in practice, the cost of independence is too high for the "
    "plan and this ADR is revisited — the property is not quietly dropped.",
    "ADR-0005 (blueprint oracle independence), ADR-0014 (definition location)",
)

write(
    '0022', 'blast-radius', 'A deterministic blast-radius scorer sets the tier; humans raise it only',
    'Accepted', 'none',
    """
Every change in the factory's target repositories needs a review tier, and the tier decides how much
owner attention it costs. A tier chosen by the agent that wrote the change is not a control; a tier
chosen by a human for every change is not automatable.

The blueprint supplies the dimensions and the tiers but not the point values that turn a dimension
reading into a tier. Those point values are a policy decision, and this ADR records them as one.
""",
    """
The blast radius is scored by a **deterministic scorer**.

- Seven dimensions, each contributing points per pack `02` §4.14.
- **Tier = max(score tier, criticality-map path floor).** A file the criticality map marks as
  critical cannot be scored below that floor by a low-scoring change.
- The tier is raised **only by humans**. The scorer can only ever lower a human's decision, never
  raise it — a change that looks small but touches a critical path still gets the critical path's tier.
""",
    """
This ADR does not decide the point values themselves — those live in the policy package and are
changed through reviewed policy change, not here. It does not decide the criticality map's contents,
which are the owner's per-repository judgement (T-0.05).
""",
    ["The tier is reproducible: the same change scores the same tier every time, on any machine, with "
     "no model call.",
     "The `max` with the criticality floor means a well-behaved scorer cannot be talked into approving "
     "a critical path.",
     "Humans raise tiers, never lower them, so the failure mode of the control is over-review rather "
     "than under-review."],
    ["Point values are guesses until they are calibrated against observed outcomes, and the pack's "
     "H-08 hypothesis (compare predicted tier to observed tier monthly) is exactly the work that fixes "
     "them.",
     "A deterministic scorer cannot see intent. A malicious or careless change that is small by every "
     "dimension still scores small.",
     "The criticality floor only helps for paths the owner has classified. An unclassified critical "
     "path has no floor."],
    ["The tier and its score components are recorded on the change, so a reviewer can see why a "
     "change was routed to them."],
    [("Let the agent choose the tier",
      "The tier is the mechanism that decides how much human attention a change receives; letting the "
      "author set it removes the control."),
     ("Have a human set the tier for every change",
      "Accurate, and it makes the factory no faster than the owner's review queue — which is the thing "
      "the factory exists to change."),
     ("Score the blast radius with a model call",
      "Non-deterministic and promptable, so the same change could score differently on two runs. A "
      "tier that can change between runs cannot be a required check.")],
    "The same change produces the same tier on repeated runs, and a change touching a critical path "
    "scores at least the critical path's floor tier.",
    "If H-08's monthly comparison shows the predicted and observed tiers diverge systematically, the "
    "point values are retuned through reviewed policy change.",
    "ADR-0021 (oracle routes), ADR-0003 (blueprint review floor)",
)

write(
    '0023', 'model-routing', 'Routing is configuration only, and the gateway refuses unknown models',
    'Accepted', 'none',
    """
Routing decisions must be auditable and changeable without a code change, and the factory must not
depend on the continued existence of any particular model. Both point the same way: routing is data.

The corollary is a hard requirement: a configuration file naming a model the gateway does not know
must fail closed, not silently fall back.
""",
    """
Routing is **configuration only** (`routing-policy.yaml`).

1. Model names in configuration are **examples**, and are `[VERIFY]`-checked against the provider's
   current model list at startup.
2. The gateway **refuses unknown models**. It does not fall back to a default.
3. The second provider is an OpenAI-compatible adapter.
4. `FakeProvider` is used in CI.
5. The **failover test is a required check** — failover is a property that must be proven, not assumed.
""",
    """
This ADR does not decide the per-class thresholds that are tuned from data (Q-16), nor the per-task
budget arithmetic, nor which provider is primary for a given task class.
""",
    ["Routing changes need no code review and no release, so a threshold can be tuned from measurement "
     "within the plan rather than at the end of it.",
     "Refusing unknown models means a typo in configuration fails loudly at startup instead of silently "
     "degrading every task's quality.",
     "The configuration is a single readable file, which makes the routing policy reviewable in the "
     "same way as any other definition."],
    ["The routing policy becomes a hot file: a policy change can alter the cost and the quality of every "
     "task at once.",
     "`FakeProvider` in CI means the CI path does not exercise the real provider's response format, so "
     "a provider-side format change is not caught by the fast suite.",
     "Startup-time model-list verification adds a dependency on the provider being reachable before "
     "the factory can start."],
    ["Model names, prices and provider hostnames appear in configuration and never in code (HR-10)."],
    [("Hard-code routing in TypeScript",
      "Every threshold tweak becomes a code change, a review and a release, and the hot path for "
      "cost control is the slowest path in the system."),
     ("A model call chooses the model",
      "Non-deterministic, unauditable, and it lets a routing decision be influenced by the content it "
      "is routing — including untrusted text."),
     ("Let the gateway fall back to a default on an unknown model",
      "A typo silently sends every task to one model at one price, and nothing in the logs says so.")],
    "The startup check fails when a configured model is not on the provider's current list, and the "
    "failover test is a required CI check.",
    "If model availability changes faster than the startup check can track, the check's refresh "
    "interval is revisited rather than removed.",
    "ADR-0017 (executor kinds), ADR-0024 (notifications)",
)

write(
    '0024', 'notifications-and-approvals', 'Approval decisions come from the access points; notifications come from a generic webhook',
    'Accepted', 'none',
    """
Approval is the one place where the factory's authority is exercised, so where the decision comes
*from* is a security property, not a UX preference. A decision delivered through a chat channel has
no verified author, no authenticated transport and no durable record of who decided what — which means
the provenance that the blueprint requires for every approval cannot be established.

Notifications have the opposite requirement: they must reach the owner wherever they are, and they
must never be able to *decide* anything.
""",
    """
1. **Approval decisions** are made only via the **authenticated access points** — the dashboard or the
   CLI. Never by replying in chat, never by a webhook, never by an email.
2. **Notifications** (the "needs you" pings) go through a **generic webhook adapter** — Slack,
   Telegram, Discord or email — chosen later. The adapter is notification-only: it carries a link to
   the access point, and it has no path to record a decision.
""",
    """
This ADR does not decide which notification provider, nor whether a second provider is run in
parallel, nor the retry and escalation policy for a notification that is never delivered. It does not
decide the access point's authentication mechanism beyond the requirement that it is authenticated.
""",
    ["Every approval has a verified author and a durable record, because it was made inside an "
     "authenticated system that logs it.",
     "The chat channel is safe to use for discussion: a comment carrying an instruction has no path to "
     "the authority, so prompt injection through comments cannot grant an approval.",
     "The notification adapter is swappable, so the owner is not locked into one chat vendor."],
    ["The owner must open the dashboard or CLI to approve anything, even when a notification is sitting "
     "in the chat they already have open.",
     "An approval round-trip is longer than a chat reply, which adds latency to every gated change.",
     "A generic webhook adapter means notifications can be silently dropped by a provider outage, and "
     "the owner may not learn that a decision is waiting."],
    ["The GitHub App is not subscribed to `issue_comment` or `pull_request_review_comment`, so comment "
     "text is not a channel in the first place."],
    [("Approve by replying in chat",
      "The approval's author is unverifiable and the decision leaves no durable provenance record — "
      "the exact property the blueprint requires."),
     ("Approve by comment on the pull request",
      "Same problem, and it also creates an instruction channel from untrusted issue text."),
     ("A single hard-wired notification provider",
      "Simpler, but it makes a vendor choice a structural dependency with no swap path.")],
    "The access-point API rejects an approval that did not arrive through an authenticated access "
    "point, and the route inventory contains no other approval path.",
    "If the review latency proves to be the binding constraint on throughput, this ADR is revisited by "
    "adding an authenticated path — not by loosening the provenance requirement.",
    "ADR-0016 (merge model), ADR-0002 (blueprint no-chat-channel)",
)

write(
    '0025', 'hosting-and-secrets', 'One Linux VM with rootless Docker; sops+age for secrets',
    'Accepted', 'none',
    """
The factory's trust boundary is the runner host: it executes untrusted repository code, so the host's
configuration is what separates a contained failure from a compromised control plane. The pack's
choice of a single VM with rootless Docker is the smallest footprint that keeps the sandbox off the
control plane's trust path.

The corpus also names the trigger for splitting them: the first workflow that handles untrusted
content.
""",
    """
**Runner host.** A Linux VM with rootless Docker (≥4 vCPU / 8 GB).

**Data.** Postgres 16+ with PITR (managed, or pgBackRest / WAL-G). An S3-compatible bucket with
versioning.

**Edge.** Caddy for TLS. The dashboard sits on a **private network** (VPN or tunnel); only
`/webhooks/github` is public.

**Secrets.** sops + age, or a cloud secret manager.
""",
    """
This ADR does not decide the cloud provider, the managed-Postgres vendor, or the bucket vendor — all
are adapters (ADR-0027). It does not decide the PITR retention window or the backup verification
schedule, which are in the production-readiness checklist.
""",
    ["One host with rootless Docker is the smallest configuration that keeps untrusted code execution "
     "off the control plane.",
     "Managed Postgres with PITR removes the operator's job of proving backups work — which, without "
     "PITR, is the single most commonly skipped operational task.",
     "A private dashboard with one public webhook endpoint minimises the exposed surface of the "
     "factory's authority.",
     "sops + age keeps encrypted secrets in git, so the secret store is versioned and reviewable "
     "without a second system."],
    ["A single host is a single point of failure: a host loss stops the factory and takes the database "
     "with it unless PITR is exercised.",
     "The 4 vCPU / 8 GB floor is a sizing assumption, not a measurement; real concurrency needs may "
     "exceed it, and the constraint is imposed by the isolation design.",
     "A private dashboard means the owner needs the VPN or tunnel running to see anything — an "
     "availability cost paid on the most common path.",
     "sops + age requires the owner to be able to run `age` wherever they decrypt, which adds friction "
     "to every manual operation."],
    ["PostgreSQL is the one fixed infrastructure dependency; everything else sits behind an adapter."],
    [("Kubernetes for the runner pool",
      "Explicitly forbidden by HR-6, and disproportionate to a two-to-four-person team with a single "
      "owner."),
     ("Managed containers for the runner",
      "Would put the sandbox on a shared control plane, which is exactly the boundary the design keeps "
      "it away from."),
     ("A separate runner host from day one",
      "The safer end of the trade-off, paid for before there is untrusted-content handling to justify "
      "it. The split is the documented trigger, not a default."),
     ("A cloud secret manager instead of sops + age",
      "Also acceptable; the choice is recorded in D8 and either satisfies the requirement.")],
    "A restore from the PITR backup is rehearsed and the runner host is confirmed to be running "
    "rootless Docker with the no-`docker.sock` rule in place.",
    "The first workflow handling untrusted content forces the runner/control-plane split, regardless "
    "of this ADR's status.",
    "ADR-0020 (isolation), ADR-0027 (adapters)",
)

write(
    '0026', 'command-surface', 'The command surface names tasks, not tools', 'Accepted', 'none',
    """
The pack's checklists and tickets are meant to survive a change of stack. If a ticket says
`pnpm test:acceptance -t "A0.1"`, then re-targeting the factory from TypeScript to Python means
rewriting every ticket — and rewriting tickets is exactly the kind of mass edit that introduces
silent drift between the checklist and the work.

The fix is to separate the *name* of the thing from the *tool* that runs it.
""",
    """
The command surface names **tasks**, not tools.

- In the TypeScript profile, a task is a `pnpm` script.
- In another profile, it is that profile's tool — and the language-neutral task runner (`just`) is the
  recommended surface.
- The **task names never change**; only the implementation behind them does.
- The **test-id selector** differs per stack, and is specified in `A1` §3:

| Stack | Selector |
|---|---|
| TypeScript / Vitest | `-t "A0.1"` |
| Python / pytest | `-k "A0_1"` |
| Go | `-run 'A0_1'` |
| .NET / xUnit | `--filter "FullyQualifiedName~A0_1"` |
| Java / JUnit 5 | `--tests '*A0_1*'` |
| Rust | `cargo test A0_1` |

The identifier rule underneath it: **the roadmap id appears verbatim in the display name and in
identifier-safe form in the function name** (`A0.1` → `A0_1`).
""",
    """
This ADR does not decide the internal build tooling of the `justfile`, nor the task runner's own
configuration format beyond the task names. It does not decide how a task is implemented in a profile
— only that the name is stable.
""",
    ["Re-targeting the stack is a change to the `justfile` and the scripts, not to the checklists or "
     "the tickets. The pack's checklists stay readable across a stack change, which is the entire "
     "point.",
     "The identifier rule makes a test selectable by its requirement id in every stack, so an oracle "
     "row in a checklist maps to exactly one test in every profile.",
     "A task name is a stable contract that tooling (the CI workflow, the mutation runner, the "
     "coverage gate) can reference without knowing the stack."],
    ["One indirection layer: a task name means nothing until the reader knows which profile is "
     "active, so every command has to be read together with the profile.",
     "The `justfile` and the `package.json` scripts can drift, and nothing mechanically checks that "
     "every `just` recipe has a matching script.",
     "The identifier rule is a convention, so a test named outside it simply cannot be selected by "
     "requirement id."],
    ["The task surface in this repo is the `justfile`; the TypeScript profile's implementation is the "
     "`pnpm` scripts in `package.json`."],
    [("Name the tools directly (`pnpm test:acceptance`)",
      "This is the obvious choice for a TypeScript-only project and it is what makes the checklists "
      "unreadable in another profile."),
     ("A generic wrapper script per task with its own syntax",
      "Reinvents the task runner and adds a thing to maintain."),
     ("Document the stack differences in prose",
      "Prose drifts. A `justfile` is executable and therefore checkable.")],
    "The `justfile` exists and every canonical task in the pack resolves through it; the checklist "
    "text refers only to task names.",
    "If a stack change ever requires editing the checklist text to remain correct, the abstraction has "
    "leaked and this ADR is revisited.",
    "ADR-0013 (stack), ADR-0027 (adapters)",
)

write(
    '0027', 'adapters-over-products', 'Every external system sits behind an interface; Postgres is the one fixed dependency',
    'Accepted', 'none',
    """
The plan's value is that it survives contact with a different target repo, a different SCM and a
different cloud. That survival depends on one property: nothing outside the factory's contracts is
named directly in business logic. Where it is not, the plan becomes a plan for one deployment.

The corpus also names the exception, and it is important — an absolute "everything is an adapter" rule
would be expensive and is not what the evidence supports.
""",
    """
1. Every external system sits behind an **interface** with a documented swap map (`A1` §7).
2. **PostgreSQL is the one fixed infrastructure dependency.** It is not abstracted away.
3. On the peak path, deploy is **GitOps-first** (`A2` §3).

The PostgreSQL exception is deliberate. The event log's gapless-sequence requirement (ADR-0019),
row-lock semantics and time partitioning are properties the factory's correctness depends on; a
portable SQL abstraction cannot preserve them, and a shim that pretended to would be a source of
subtle divergence. Postgres is therefore a constraint, and the cost of that constraint is paid
knowingly.
""",
    """
This ADR does not decide which products the adapters wrap — that is the swap map in `A1` §7. It does
not decide the deploy mechanics beyond GitOps-first on the peak path.
""",
    ["The plan stays valid when the target uses GitLab, a different cloud or a different runtime, "
     "because the seams are the interfaces rather than the products.",
     "PostgreSQL's special status means the one place where correctness really depends on engine "
     "semantics is the one place that is not abstracted into a leaky shim.",
     "GitOps-first means the factory's own deployment has the same audit trail as its outputs."],
    ["Postgres is a real constraint: the factory cannot be pointed at a different database, and the "
     "swap map has a hole in it by design.",
     "Each adapter is another surface to maintain, and the interface has to be designed well enough to "
     "cover two products it will not actually be used with.",
     "The one fixed dependency concentrates the operational risk: Postgres becomes the single thing "
     "whose failure stops the factory."],
    ["The swap map in `A1` §7 records which product each interface currently wraps."],
    [("Abstract the database too",
      "A portable SQL layer cannot preserve gapless sequencing under a row lock, and a shim that "
      "pretended to would diverge subtly — the worst possible failure for an audit trail."),
     ("Name products directly everywhere",
      "The plan becomes a plan for one deployment; every change of supplier becomes a change of the "
      "factory's business logic."),
     ("Abstract everything except databases, with no interface at all",
      "Gives up the property that the plan survives a supplier change, for no gain.")],
    "Every external system the factory calls is reached through a named interface, and the dependency "
    "rules reject a direct import of a vendor SDK outside the adapter package.",
    "If a new product category appears that the interfaces do not cover, a new interface is added "
    "rather than the boundary dissolved.",
    "ADR-0025 (hosting), ADR-0026 (command surface)",
)
