/**
 * The orchestrator package's mutation harness.
 *
 * ## Why this exists
 *
 * A check that has never been **shown** to fail may be silently passing.
 * That is not a theoretical worry: in T-1.07 a mutation "survived" because
 * it changed nothing — the mutation was vacuous, and the suite's green was
 * meaningless. In T-1.11 a mutation survived because the test asserted a
 * **constant against itself**. In T-1.12 four mutations survived, three of
 * them because two different checks could produce the *same* refusal, so a
 * test asserting either one passed even when the check it meant was gone.
 *
 * So this harness applies a named mutation to the orchestrator package's
 * source, runs the test file that is supposed to catch it, and reports
 * whether the suite **failed**. A mutation that survives means the oracle
 * does not cover the rule it claims to cover.
 *
 * ## The rules worth breaking
 *
 * The orchestrator holds the factory's **control decisions** — which
 * executor runs a stage, whether a failure is retried, whether a budget is
 * exhausted, what a dead task becomes. Each mutation below breaks exactly
 * one rule, and names the test file that is supposed to catch it:
 *
 * 1. the **stage-kind matrix** — an unimplemented kind becomes runnable, the
 *    harness restriction is dropped;
 * 2. the **failure classification** — the `unknown → workflow.composition`
 *    default is lost, a retry count changes, a policy denial becomes
 *    retryable;
 * 3. the **budget** — a dimension stops being checked, the incomplete label
 *    is dropped;
 * 4. the **runner** — the budget is checked after the executor, the cleanup
 *    is skipped, the result is persisted after the transition;
 * 5. the **resume and cancel paths** — the escalation is skipped, the
 *    re-queue happens twice, the credentials are not revoked.
 *
 * ## How a mutation is declared
 *
 * A mutation is a **file**, a **search string**, and a **replacement**. The
 * harness:
 *
 * 1. reads the file;
 * 2. asserts the search string is present **exactly once** — a mutation that
 *    matches zero times or many times is *vacuous*, and it is reported as
 *    such rather than as a survivor;
 * 3. writes the mutated file in place, runs the tests, and restores the
 *    original in a `finally`, so a failing run still restores the file.
 *
 * ## Running it
 *
 * ```bash
 * pnpm run test:mutation:orchestrator
 * ```
 *
 * The exit code is non-zero when a mutation survives or is vacuous.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(import.meta.dirname, '..');

/**
 * A mutation.
 */
interface Mutation {
  /** The rule it breaks. */
  readonly name: string;
  /** The file it mutates, relative to the repo root. */
  readonly file: string;
  /** The text it replaces — must appear exactly once. */
  readonly search: string;
  /** The text it puts in its place. */
  readonly replace: string;
  /** The test file that must fail. */
  readonly test: string;
}

/**
 * The mutations.
 *
 * Each one breaks exactly **one** rule, and names the test file that is
 * supposed to catch it.
 */
const MUTATIONS: readonly Mutation[] = [
  // ---- the stage-kind matrix -----------------------------------------
  {
    name: 'an unimplemented stage kind becomes runnable',
    file: 'packages/orchestrator/src/runtime/stage-kinds.ts',
    search: `  if (!isImplementedStageKind(kind)) {
    return {
      ok: false,
      reason: \`the stage kind "\${kind}" is not implemented in v1\`,
    };
  }`,
    replace: `  // MUTATION: the unimplemented-stage check is gone.`,
    test: 'tests/unit/orchestrator-stage-kinds.test.ts',
  },
  {
    name: 'the ADR-0017 harness restriction is dropped',
    file: 'packages/orchestrator/src/runtime/stage-kinds.ts',
    search: `  if (declared === 'harness' && !harnessAllowedFor(kind)) {`,
    replace: `  if (false) {`,
    test: 'tests/unit/orchestrator-stage-kinds.test.ts',
  },
  {
    name: 'the default executor for a stage kind is ignored',
    file: 'packages/orchestrator/src/runtime/stage-kinds.ts',
    search: `  if (declared === undefined) {
    return { ok: true, executor: DEFAULT_EXECUTOR_BY_STAGE[kind] };
  }`,
    replace: `  if (declared === undefined) {
    return { ok: true, executor: 'completion' };
  }`,
    test: 'tests/unit/orchestrator-stage-kinds.test.ts',
  },

  // ---- the failure classification ------------------------------------
  {
    name: 'the unknown to workflow.composition default is lost',
    file: 'packages/orchestrator/src/runtime/failures.ts',
    search: `  unknown: { maxRetries: 0, backoff: false, treatedAs: 'workflow.composition' },`,
    replace: `  unknown: { maxRetries: 0, backoff: false, treatedAs: 'unknown' },`,
    test: 'tests/unit/orchestrator-failures.test.ts',
  },
  {
    name: 'a policy denial becomes retryable',
    file: 'packages/orchestrator/src/runtime/failures.ts',
    search: `  'policy.denied': { maxRetries: 0, backoff: false, treatedAs: 'policy.denied' },`,
    replace: `  'policy.denied': { maxRetries: 2, backoff: false, treatedAs: 'policy.denied' },`,
    test: 'tests/unit/orchestrator-failures.test.ts',
  },
  {
    name: 'a model-reasoning failure is no longer retried',
    file: 'packages/orchestrator/src/runtime/failures.ts',
    search: `  'model.reasoning': { maxRetries: 2, backoff: false, treatedAs: 'model.reasoning' },`,
    replace: `  'model.reasoning': { maxRetries: 0, backoff: false, treatedAs: 'model.reasoning' },`,
    test: 'tests/unit/orchestrator-failures.test.ts',
  },
  {
    name: 'a tool outage loses its third retry',
    file: 'packages/orchestrator/src/runtime/failures.ts',
    search: `  'tool.unavailable': { maxRetries: 3, backoff: true, treatedAs: 'tool.unavailable' },`,
    replace: `  'tool.unavailable': { maxRetries: 2, backoff: true, treatedAs: 'tool.unavailable' },`,
    test: 'tests/unit/orchestrator-failures.test.ts',
  },
  {
    name: 'a policy denial no longer escalates',
    file: 'packages/orchestrator/src/runtime/failures.ts',
    search: `    escalate: effective === 'policy.denied',`,
    replace: `    escalate: false,`,
    test: 'tests/unit/orchestrator-failures.test.ts',
  },
  {
    name: 'the backoff no longer doubles',
    file: 'packages/orchestrator/src/runtime/failures.ts',
    search: `  const exponent = attempt - 2;`,
    replace: `  const exponent = 0;`,
    test: 'tests/unit/orchestrator-failures.test.ts',
  },

  // ---- the budget -----------------------------------------------------
  {
    name: 'the turn budget stops being checked',
    file: 'packages/orchestrator/src/runtime/budget.ts',
    search: `  const turns = budget.turns ?? 0;
  if (budget.maxTurns !== undefined && turns >= budget.maxTurns) {`,
    replace: `  const turns = budget.turns ?? 0;
  if (false) {`,
    test: 'tests/unit/orchestrator-budget.test.ts',
  },
  {
    name: 'the cost budget stops being checked',
    file: 'packages/orchestrator/src/runtime/budget.ts',
    search: `  const spentUsdMicros = budget.spentUsdMicros ?? 0;
  if (budget.maxCostUsdMicros !== undefined && spentUsdMicros >= budget.maxCostUsdMicros) {`,
    replace: `  const spentUsdMicros = budget.spentUsdMicros ?? 0;
  if (false) {`,
    test: 'tests/unit/orchestrator-budget.test.ts',
  },
  {
    name: 'the incomplete label is dropped from the partial artefacts',
    file: 'packages/orchestrator/src/runtime/budget.ts',
    search: `  artefacts.map((artefact) => ({
    ref: artefact.ref,
    sha256: artefact.sha256,
    label: INCOMPLETE_ARTEFACT_LABEL,
  }));`,
    replace: `  artefacts.map((artefact) => ({
    ref: artefact.ref,
    sha256: artefact.sha256,
  }));`,
    test: 'tests/unit/orchestrator-budget.test.ts',
  },

  // ---- the runner -----------------------------------------------------
  {
    name: 'the budget is checked after the executor instead of before it',
    file: 'packages/orchestrator/src/runtime/runner.ts',
    search: `    const budgetVerdict = checkBudget(request.budget);
    if (budgetVerdict.exhausted) {`,
    replace: `    const budgetVerdict = { exhausted: false as const };
    if (budgetVerdict.exhausted) {`,
    test: 'tests/unit/orchestrator-runner.test.ts',
  },
  {
    name: 'the runner no longer reclaims the environment',
    file: 'packages/orchestrator/src/runtime/runner.ts',
    search: `      await this.#environments.reclaim(runId);`,
    replace: `      // MUTATION: the environment is no longer reclaimed.
      void runId;`,
    test: 'tests/unit/orchestrator-runner.test.ts',
  },
  {
    name: 'the runner no longer revokes the credentials',
    file: 'packages/orchestrator/src/runtime/runner.ts',
    search: `      await this.#credentials.reclaim(runId);`,
    replace: `      // MUTATION: the credentials are no longer revoked.
      void runId;`,
    test: 'tests/unit/orchestrator-runner.test.ts',
  },
  {
    name: 'a failed credential revocation is swallowed when the environment also failed',
    file: 'packages/orchestrator/src/runtime/runner.ts',
    search: `    try {
      await this.#credentials.reclaim(runId);
    } catch {
      throw new Error('the credential reclamation failed');
    }`,
    replace: `    try {
      await this.#credentials.reclaim(runId);
    } catch {
      // MUTATION: the failed credential revocation is swallowed.
    }`,
    test: 'tests/unit/orchestrator-runner.test.ts',
  },
  {
    name: 'a failure with no class is no longer a workflow composition failure',
    file: 'packages/orchestrator/src/runtime/runner.ts',
    search: `    const recordedClass: FailureClass = rawClass ?? 'unknown';`,
    replace: `    const recordedClass: FailureClass = rawClass ?? 'model.reasoning';`,
    test: 'tests/unit/orchestrator-runner.test.ts',
  },
  {
    name: 'the runner no longer rejects an unimplemented stage kind',
    file: 'packages/orchestrator/src/runtime/runner.ts',
    search: `    const resolved = this.#registry.resolve(request.stageKind, request.declaredExecutor);
    if (!resolved.ok) {`,
    replace: `    const resolved = this.#registry.resolve(request.stageKind, request.declaredExecutor);
    if (false) {`,
    test: 'tests/unit/orchestrator-runner.test.ts',
  },

  // ---- the loop -------------------------------------------------------
  {
    name: 'the loop no longer checks the cancellation between steps',
    file: 'packages/orchestrator/src/runtime/loop.ts',
    search: `      if (token.cancelled) {
        return {
          outcomes,
          cancelled: true,
          cancelReason: token.reason ?? 'no reason given',
        };
      }`,
    replace: `      // MUTATION: the between-steps cancellation check is gone.`,
    test: 'tests/unit/orchestrator-loop.test.ts',
  },

  // ---- the resume path ------------------------------------------------
  {
    name: 'a dead task is no longer escalated',
    file: 'packages/orchestrator/src/runtime/resume.ts',
    search: `      const escalated = await this.#deps.state.transition({
        taskId: task.taskId,
        nodeId: task.taskId,
        to: 'ESCALATED',
        trigger: RESUME_FAILED_TRIGGER,
        facts: { escalationTrigger: RESUME_FAILED_TRIGGER },
      });`,
    replace: `      // MUTATION: the dead task is no longer escalated.
      const escalated = { ok: true } as { ok: boolean; reason?: string };`,
    test: 'tests/unit/orchestrator-resume.test.ts',
  },
  {
    name: 'the expired leases are no longer re-queued',
    file: 'packages/orchestrator/src/runtime/resume.ts',
    search: `        const released = await this.#deps.leases.release(lease);`,
    replace: `        // MUTATION: the expired lease is no longer re-queued.
        const released = { released: false };`,
    test: 'tests/unit/orchestrator-resume.test.ts',
  },
  {
    name: 'a live lease is re-queued as well',
    file: 'packages/orchestrator/src/runtime/resume.ts',
    search: `        if (lease.expiresAt > now) {`,
    replace: `        if (false) {`,
    test: 'tests/unit/orchestrator-resume.test.ts',
  },

  // ---- the cancel path ------------------------------------------------
  {
    name: 'the cancel path no longer revokes the credentials',
    file: 'packages/orchestrator/src/runtime/cancel.ts',
    search: `      try {
        await this.#deps.credentials.reclaim(input.runId);
        credentialsRevoked = true;
      } catch (error) {`,
    replace: `      try {
        // MUTATION: the credentials are no longer revoked.
        credentialsRevoked = true;
      } catch (error) {`,
    test: 'tests/unit/orchestrator-cancel.test.ts',
  },
  {
    name: 'the cancel path no longer kills the harness sandbox',
    file: 'packages/orchestrator/src/runtime/cancel.ts',
    search: `          await this.#deps.harness.kill(input.runId);
          sandboxKilled = true;`,
    replace: `          // MUTATION: the sandbox is no longer killed.
          sandboxKilled = true;`,
    test: 'tests/unit/orchestrator-cancel.test.ts',
  },
  {
    name: 'the credential revocation is skipped when the environment reclamation failed',
    file: 'packages/orchestrator/src/runtime/cancel.ts',
    search: `    if (input.runId !== undefined) {
      try {
        await this.#deps.credentials.reclaim(input.runId);
        credentialsRevoked = true;
      } catch (error) {`,
    replace: `    if (input.runId !== undefined && environmentReclaimed) {
      try {
        await this.#deps.credentials.reclaim(input.runId);
        credentialsRevoked = true;
      } catch (error) {`,
    test: 'tests/unit/orchestrator-cancel.test.ts',
  },

  // ---- the run store's idempotency ------------------------------------
  {
    name: 'a finished run is resurrected by a duplicated handler call',
    file: 'packages/orchestrator/src/runtime/fakes/in-memory-run-store.ts',
    search: `    if (existing.status !== 'running') {
      return Promise.resolve();
    }`,
    replace: `    // MUTATION: the finished run is resurrected.`,
    test: 'tests/fault/a0-5.test.ts',
  },
  {
    name: 'the first committed result no longer wins',
    file: 'packages/orchestrator/src/runtime/fakes/in-memory-run-store.ts',
    search: `    if (existing.status !== 'running') {
      return Promise.resolve({ applied: false, winnerRunId: existing.runId });
    }`,
    replace: `    // MUTATION: the second result is applied too.`,
    test: 'tests/fault/a0-5.test.ts',
  },

  // ---- the context resolution (A0.4) ------------------------------------
  //
  // This mutation is here because the A0.4 oracle was **missing** when
  // the G1 pack was written, and the first version of the test that
  // closed the gap compared `outcome.record` — which is `undefined`,
  // because the outcome carries the record's *location*, not the
  // record. `toEqual(undefined, undefined)` passed against a build
  // whose context resolution was random. This mutation is what caught
  // that, and it is kept so the mistake cannot come back.
  {
    name: 'the resolved context digest becomes random',
    file: 'packages/orchestrator/src/hello/record-executor.ts',
    search: `      context: this.#options.context,`,
    replace: `      context: {
        ...this.#options.context,
        manifest: {
          ...this.#options.context.manifest,
          resolvedContextSha256: \`sha256:\${String(Math.random()).slice(2).padEnd(64, '0')}\`,
        },
      },`,
    test: 'tests/unit/orchestrator-a0-4-identical-context.test.ts',
  },
];

/**
 * Run a test file and report whether it **failed**.
 *
 * Vitest exits 1 when the suite fails — that is the mutation being caught.
 * Any other exit code is a harness error and is re-thrown.
 */
const testsFailed = async (file: string): Promise<boolean> => {
  try {
    await execFileAsync(
      'pnpm',
      ['exec', 'vitest', 'run', file, '--reporter=dot'],
      { cwd: repoRoot, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 },
    );
    return false;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1) {
      return true;
    }
    throw error;
  }
};

/**
 * Run every mutation.
 */
const main = async (): Promise<void> => {
  let survived = 0;
  let vacuous = 0;
  let caught = 0;

  for (const mutation of MUTATIONS) {
    const path = join(repoRoot, mutation.file);
    const original = await readFile(path, 'utf8');

    const occurrences = original.split(mutation.search).length - 1;
    if (occurrences !== 1) {
      process.stdout.write(
        `VACUOUS  ${mutation.name} — the search text appears ${String(occurrences)} times in ${mutation.file}\n`,
      );
      vacuous += 1;
      continue;
    }

    await writeFile(path, original.replace(mutation.search, mutation.replace), 'utf8');

    let wasCaught = false;
    try {
      wasCaught = await testsFailed(mutation.test);
    } finally {
      await writeFile(path, original, 'utf8');
    }

    if (wasCaught) {
      caught += 1;
      process.stdout.write(`CAUGHT   ${mutation.name}\n`);
    } else {
      survived += 1;
      process.stdout.write(
        `SURVIVED ${mutation.name} — ${mutation.test} did not fail\n`,
      );
    }
  }

  process.stdout.write(
    `\n${String(caught)} caught, ${String(survived)} survived, ${String(vacuous)} vacuous\n`,
  );

  if (survived > 0 || vacuous > 0) {
    process.exitCode = 1;
  }
};

await main();
