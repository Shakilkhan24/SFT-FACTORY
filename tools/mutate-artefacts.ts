/**
 * The artefacts package's mutation harness.
 *
 * ## Why this exists
 *
 * A check that has never been **shown** to fail may be silently passing.
 * That is not a theoretical worry: in T-1.07 a mutation "survived" because
 * it changed nothing — the mutation was vacuous, and the suite's green was
 * meaningless.
 *
 * So this harness applies a named mutation to the artefacts package's
 * source, runs the test file that is supposed to catch it, and reports
 * whether the suite **failed**. A mutation that survives means the oracle
 * does not cover the rule it claims to cover.
 *
 * ## The rules worth breaking
 *
 * The artefacts package holds the factory's **evidence** rules, and the
 * ticket's oracle is A0.3: *"A run produces a complete artefact with every
 * one of the 12 required elements."* Each mutation below breaks exactly
 * one rule, and names the test file that is supposed to catch it:
 *
 * 1. the **completeness** — the assertion stops counting the twelve, a
 *    list element stops being allowed to be empty, an absent element stops
 *    being incomplete;
 * 2. the **redaction** — the capture-time pass stops running, the receipt
 *    starts carrying the secret, the rule cursor restarts per branch;
 * 3. the **atomicity** — the row is written before the object, the
 *    spool-then-fail path stops spooling, the purge starts deleting rows;
 * 4. the **honesty** — the hash stops covering the content, the retention
 *    expiry is computed from the wrong instant, the terminal event is
 *    appended outside the transaction.
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
 * pnpm run test:mutation:artefacts
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
  // ---- the completeness (A0.3) ---------------------------------------
  {
    name: 'the completeness assertion stops counting the twelve elements',
    file: 'packages/artefacts/src/completeness.ts',
    search: `  for (const element of REQUIRED_ELEMENTS) {
    const value = elementValue(record, element);`,
    replace: `  for (const element of REQUIRED_ELEMENTS.slice(0, 4)) {
    const value = elementValue(record, element);`,
    test: 'tests/unit/artefacts-a0-3-completeness.test.ts',
  },
  {
    name: 'an absent element is no longer incomplete',
    file: 'packages/artefacts/src/completeness.ts',
    search: `    if (!present) {
      reason = \`element \${String(ELEMENT_NUMBERS[element])} (\${element}) is absent\`;
    } else if (!mayBeEmpty && !nonEmpty) {`,
    replace: `    if (!present) {
      // MUTATION: an absent element is accepted.
    } else if (!mayBeEmpty && !nonEmpty) {`,
    test: 'tests/unit/artefacts-a0-3-completeness.test.ts',
  },
  {
    name: 'a present-but-empty single-valued element is accepted',
    file: 'packages/artefacts/src/completeness.ts',
    search: `    } else if (!mayBeEmpty && !nonEmpty) {
      reason = \`element \${String(ELEMENT_NUMBERS[element])} (\${element}) is empty\`;
    }`,
    replace: `    } else if (!mayBeEmpty && false) {
      reason = \`element \${String(ELEMENT_NUMBERS[element])} (\${element}) is empty\`;
    }`,
    test: 'tests/unit/artefacts-a0-3-completeness.test.ts',
  },
  {
    name: 'the list elements stop being allowed to be empty',
    file: 'packages/artefacts/src/completeness.ts',
    search: `export const MAY_BE_EMPTY: ReadonlySet<RequiredElement> = new Set<RequiredElement>([
  'toolCalls',
  'prompts',
  'verification',
  'artefacts',
  'authority',
  'policyDecisions',
]);`,
    replace: `export const MAY_BE_EMPTY: ReadonlySet<RequiredElement> = new Set<RequiredElement>([
  'toolCalls',
  'prompts',
  'verification',
  'artefacts',
  'authority',
  'policyDecisions',
  'outcome',
  'cost',
  'budget',
  'identity',
]);`,
    test: 'tests/unit/artefacts-a0-3-completeness.test.ts',
  },
  {
    name: 'the element numbers are no longer the blueprint’s',
    file: 'packages/artefacts/src/types.ts',
    search: `  budget: 11,
  policyDecisions: 12,
};`,
    replace: `  budget: 11,
  policyDecisions: 11,
};`,
    test: 'tests/unit/artefacts-a0-3-completeness.test.ts',
  },
  {
    name: 'the store no longer refuses an incomplete record',
    file: 'packages/artefacts/src/store.ts',
    search: `    const report = assertComplete(record);
    if (!report.complete) {
      throw new IncompleteRecordError(incompletenessMessage(report), report.missing);
    }`,
    replace: `    const report = assertComplete(record);
    if (!report.complete) {
      // MUTATION: the incomplete record is written anyway.
    }`,
    test: 'tests/unit/artefacts-store.test.ts',
  },

  // ---- the redaction ---------------------------------------------------
  {
    name: 'the capture-time redaction does not run at all',
    file: 'packages/artefacts/src/redaction.ts',
    search: `  const scrubbed = registry.scrubJson(value);`,
    replace: `  const scrubbed = { value, applied: [] as const };`,
    test: 'tests/unit/artefacts-redaction.test.ts',
  },
  {
    name: 'the structural pass does not run, so sensitive keys are kept',
    file: 'packages/artefacts/src/redaction.ts',
    search: `  const structural = redactorFor(policy);
  const structuralResult = structural(scrubbed.value as never);`,
    replace: `  const structural = redactorFor(policy);
  const structuralResult = { value: scrubbed.value, applied: [] as never[] };`,
    test: 'tests/unit/artefacts-redaction.test.ts',
  },
  {
    name: 'the receipt carries the removed value, not a digest of it',
    file: 'packages/artefacts/src/redaction.ts',
    search: `      applied.push({
        path: path === '' ? '<root>' : path,
        rule: rule?.rule ?? 'exact.minted',
        digest: rule?.digest ?? '',
      });`,
    replace: `      applied.push({
        path: path === '' ? '<root>' : path,
        rule: rule?.rule ?? 'exact.minted',
        // MUTATION: the receipt carries the secret itself.
        digest: String(original),
      });`,
    test: 'tests/unit/artefacts-redaction.test.ts',
  },
  {
    name: 'the rule cursor restarts in every branch, so paths get the wrong rule',
    file: 'packages/artefacts/src/redaction.ts',
    search: `    cursor.index += 1;
    return rule;`,
    replace: `    cursor.index = 0;
    return rule;`,
    test: 'tests/unit/artefacts-redaction.test.ts',
  },
  {
    name: 'the redaction receipt names no policy',
    file: 'packages/artefacts/src/redaction.ts',
    search: `  return {
    receipt: { applied, policyRef: policy.policyRef },
    value: structuralResult.value,
  };`,
    replace: `  return {
    receipt: { applied, policyRef: '' },
    value: structuralResult.value,
  };`,
    test: 'tests/unit/artefacts-redaction.test.ts',
  },

  // ---- the atomicity ---------------------------------------------------
  {
    name: 'the row is written before the object, so a failed write leaves a row',
    file: 'packages/artefacts/src/store.ts',
    search: `    try {
      const location = await this.#objectStore.put(key, bytes);
      const recordUri = location.uri;

      // ---- 4. write the row and the terminal event, in one transaction -----
      await this.#runStore.writeFinalised({`,
    replace: `    try {
      const recordUri = 's3://factory-artifacts/' + key;

      // MUTATION: the row is written before the object.
      await this.#runStore.writeFinalised({`,
    test: 'tests/unit/artefacts-store.test.ts',
  },
  {
    name: 'the spool-then-fail path does not spool',
    file: 'packages/artefacts/src/store.ts',
    search: `      await this.#spool.spool(key, bytes);
      throw error;`,
    replace: `      // MUTATION: the bytes are lost, not spooled.
      throw error;`,
    test: 'tests/unit/artefacts-store.test.ts',
  },
  {
    name: 'a failed object write still reports success',
    file: 'packages/artefacts/src/store.ts',
    search: `    } catch (error) {
      // The object could not be stored. The bytes are spooled so they are
      // not lost, and the stage **fails** — pack 04 INT-08: "spool locally,
      // then fail stage". No row is written, so there is no completed run
      // without a complete artefact.
      await this.#spool.spool(key, bytes);
      throw error;
    }`,
    replace: `    } catch (error) {
      // MUTATION: the failure is swallowed and the write "succeeds".
      await this.#spool.spool(key, bytes);
      return {
        runId: record.identity.runId,
        recordUri: 's3://factory-artifacts/' + key,
        recordSha256: record.sha256,
        record,
      };
    }`,
    test: 'tests/unit/artefacts-store.test.ts',
  },
  {
    name: 'the purge deletes the row instead of marking it',
    file: 'packages/artefacts/src/fakes/in-memory-run-record-store.ts',
    search: `    const { recordUri: _uri, recordSha256: _digest, ...rest } = row;
    void _uri;
    void _digest;
    this.#rows.set(runId, { ...rest, status: 'purged' });`,
    replace: `    this.#rows.delete(runId);`,
    test: 'tests/unit/artefacts-retention.test.ts',
  },
  {
    name: 'a failed delete still marks the row purged',
    file: 'packages/artefacts/src/purge.ts',
    search: `      } catch (error) {
        // The bytes are still there, so the row is **not** marked. The
        // failure is reported and the row stays eligible for the next pass.
        failed.push({
          runId: candidate.runId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }`,
    replace: `      } catch (error) {
        // MUTATION: the row is marked even though the bytes are still there.
        await this.#runStore.markPurged(candidate.runId);
        failed.push({
          runId: candidate.runId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }`,
    test: 'tests/unit/artefacts-retention.test.ts',
  },

  // ---- the honesty -----------------------------------------------------
  {
    name: 'the hash covers the record including its own hash',
    file: 'packages/artefacts/src/record.ts',
    search: `export const hashRecord = (record: RunRecord): RecordDigest => {
  const { sha256: _sealed, ...content } = record;
  void _sealed;
  return hashRecordContent(content as RunRecordContent);
};`,
    replace: `export const hashRecord = (record: RunRecord): RecordDigest =>
  hashRecordContent(record as unknown as RunRecordContent);`,
    test: 'tests/unit/artefacts-record.test.ts',
  },
  {
    name: 'the builder hashes the parts instead of the assembled record',
    file: 'packages/artefacts/src/record.ts',
    search: `  return { ...content, sha256: hashRecordContent(content) };`,
    replace: `  // MUTATION: the hash is over the parts, so the flattened elements are
  // outside it.
  return { ...content, sha256: hashRecordContent(parts as unknown as RunRecordContent) };`,
    test: 'tests/unit/artefacts-record.test.ts',
  },
  {
    name: 'the verification always succeeds',
    file: 'packages/artefacts/src/record.ts',
    search: `export const recordHashVerifies = (record: RunRecord): boolean =>
  record.sha256 === hashRecord(record);`,
    replace: `export const recordHashVerifies = (record: RunRecord): boolean => true;`,
    test: 'tests/unit/artefacts-record.test.ts',
  },
  {
    name: 'the expiry is computed from the start, not the completion',
    file: 'packages/artefacts/src/store.ts',
    search: `    const retentionExpiry = expiry ?? expiryFor(retentionClass, new Date(parts.completedAt));`,
    replace: `    const retentionExpiry = expiry ?? expiryFor(retentionClass, new Date(parts.startedAt));`,
    test: 'tests/unit/artefacts-store.test.ts',
  },
  {
    name: 'the retention date is the instant, not the calendar day',
    file: 'packages/artefacts/src/retention.ts',
    search: `export const retainUntilDate = (expiresAt: Date): string => expiresAt.toISOString().slice(0, 10);`,
    replace: `export const retainUntilDate = (expiresAt: Date): string => expiresAt.toISOString();`,
    test: 'tests/unit/artefacts-retention.test.ts',
  },
  {
    name: 'the month arithmetic does not clamp a short month',
    file: 'packages/artefacts/src/retention.ts',
    search: `    out.setUTCDate(Math.min(day, lastDay));`,
    replace: `    out.setUTCDate(day);`,
    test: 'tests/unit/artefacts-retention.test.ts',
  },
  {
    name: 'the purge selects a row whose retain_until is in the future',
    file: 'packages/artefacts/src/retention.ts',
    search: `      return row.retainUntil <= asOf;`,
    replace: `      return true;`,
    test: 'tests/unit/artefacts-retention.test.ts',
  },
  {
    name: 'the purge selects a row whose class is not one of the six',
    file: 'packages/artefacts/src/retention.ts',
    search: `      if (!isRetentionClass(row.retentionClass)) {
        return false;
      }`,
    replace: `      // MUTATION: an unknown class is purged under a rule that does not exist.`,
    test: 'tests/unit/artefacts-retention.test.ts',
  },
  {
    name: 'the record’s key is not derived from the run id',
    file: 'packages/artefacts/src/store.ts',
    search: `export const recordKey = (runId: string): string => \`runs/\${runId}/record.json\`;`,
    replace: `export const recordKey = (runId: string): string => \`records/\${runId}.json\`;`,
    test: 'tests/unit/artefacts-store.test.ts',
  },
  {
    name: 'the object store reports a refused write as a success',
    file: 'packages/artefacts/src/object-store.ts',
    search: `    if (response.status < 200 || response.status >= 300) {
      throw new ObjectStoreError(
        \`the object store refused the write of "\${key}" (status \${String(response.status)})\`,
      );
    }`,
    replace: `    // MUTATION: the refusal is swallowed.`,
    test: 'tests/unit/artefacts-object-store.test.ts',
  },
  {
    name: 'the object store’s URI names the endpoint, not the bucket',
    file: 'packages/artefacts/src/object-store.ts',
    search: `  #uriFor(key: string): string {
    return \`s3://\${this.#options.bucket}/\${key}\`;
  }`,
    replace: `  #uriFor(key: string): string {
    return \`s3://\${this.#options.endpoint}/\${key}\`;
  }`,
    test: 'tests/unit/artefacts-object-store.test.ts',
  },
  {
    name: 'the object store does not sign the request',
    file: 'packages/artefacts/src/object-store.ts',
    search: `    const headers = await this.#options.signer({
      method: 'PUT',
      url,
      headers: { 'content-type': 'application/json' },
      body: bytes,
    });`,
    replace: `    // MUTATION: the request is not signed.
    const headers: Readonly<Record<string, string>> = { 'content-type': 'application/json' };`,
    test: 'tests/unit/artefacts-object-store.test.ts',
  },
];

/**
 * Run a test file and report whether it failed.
 *
 * A **failure** is the expected outcome for a caught mutation. A crash of
 * the runner itself is not a failure of the oracle — it is a failure of
 * the harness, and it is reported separately.
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
      // Vitest exits 1 when the suite fails. That is the mutation being
      // caught.
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
