/**
 * The isolation package's mutation harness.
 *
 * ## Why this exists
 *
 * A check that has never been **shown** to fail may be silently passing.
 * That is not a theoretical worry: in T-1.07 a mutation "survived" because
 * it changed nothing — the mutation was vacuous, and the suite's green was
 * meaningless. And in T-1.11 a mutation survived because the test asserted
 * a **constant against itself**: it compared `ELEMENT_NUMBERS.x` to
 * `ELEMENT_NUMBERS.x`, so it could not notice the constant changing.
 *
 * So this harness applies a named mutation to the isolation package's
 * source, runs the test file that is supposed to catch it, and reports
 * whether the suite **failed**. A mutation that survives means the oracle
 * does not cover the rule it claims to cover.
 *
 * ## The rules worth breaking
 *
 * The isolation package holds the factory's **containment** rules, and the
 * ticket's oracle is A0.9. Each mutation below breaks exactly one rule,
 * and names the test file that is supposed to catch it:
 *
 * 1. the **traversal defence** — the path walk stops walking, the link
 *    target stops being resolved, the key stops being checked, a hostile
 *    member stops being refused;
 * 2. the **git invocation** — the canonical flags are dropped, the argv
 *    becomes a shell string, the base SHA is not the one archived;
 * 3. the **reclamation** — the terminal states stop reclaiming, the
 *    escalated task starts reclaiming, the directory survives, the record
 *    survives;
 * 4. the **detector** — the leak stops being reported.
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
 * pnpm run test:mutation:isolation
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
  // ---- the traversal defence -----------------------------------------
  {
    name: 'the path walk stops walking — a `..` climb is no longer an escape',
    file: 'packages/isolation/src/t1/paths.ts',
    search: `    if (segment === '..') {
      if (walked.length === 0) {
        return {
          ok: false,
          reason: \`the path "\${candidate}" resolves outside "\${root}"\`,
        };
      }
      walked.pop();
      continue;
    }`,
    replace: `    if (segment === '..') {
      // MUTATION: the climb is no longer refused.
      walked.push(segment);
      continue;
    }`,
    test: 'tests/unit/isolation-paths.test.ts',
  },
  {
    name: 'the path walk stops popping — a `..` climb lands inside the root',
    file: 'packages/isolation/src/t1/paths.ts',
    search: `          reason: \`the path "\${candidate}" resolves outside "\${root}"\`,
        };
      }
      walked.pop();
      continue;
    }
    walked.push(segment);
  }

  const joined`,
    replace: `          reason: \`the path "\${candidate}" resolves outside "\${root}"\`,
        };
      }
      // MUTATION: the pop is gone.
      continue;
    }
    walked.push(segment);
  }

  const joined`,
    test: 'tests/unit/isolation-paths.test.ts',
  },
  {
    name: 'an absolute path is no longer refused',
    file: 'packages/isolation/src/t1/paths.ts',
    search: `  // An absolute path is an escape, not a path.
  if (name.startsWith('/')) {
    return { ok: false, failure: 'absolute' };
  }`,
    replace: `  // MUTATION: the absolute-path check is gone.`,
    test: 'tests/unit/isolation-paths.test.ts',
  },
  {
    name: 'the link target stops being resolved against the link’s directory',
    file: 'packages/isolation/src/t1/paths.ts',
    search: `  if (target.startsWith('/')) {
    return {
      ok: false,
      reason: \`the link "\${memberName}" points at the absolute path "\${target}"\`,
    };
  }`,
    replace: `  // MUTATION: the absolute target is no longer refused.`,
    test: 'tests/unit/isolation-paths.test.ts',
  },
  {
    name: 'a link target that climbs out is no longer refused',
    file: 'packages/isolation/src/t1/paths.ts',
    search: `    if (segment === '..') {
      if (walked.length === 0) {
        return {
          ok: false,
          reason: \`the link "\${memberName}" points outside the snapshot\`,
        };
      }`,
    replace: `    if (segment === '..') {
      // MUTATION: the climb out of a link is no longer refused.
      if (false) {
        return {
          ok: false,
          reason: \`the link "\${memberName}" points outside the snapshot\`,
        };
      }`,
    test: 'tests/unit/isolation-paths.test.ts',
  },
  {
    name: 'the base SHA is no longer validated',
    file: 'packages/isolation/src/t1/paths.ts',
    search: `  if (!SHA_PATTERN.test(value)) {
    return {
      ok: false,
      reason:
        \`the base SHA "\${value}" is not a 40-character lower-case hex commit name\`,
    };
  }`,
    replace: `  // MUTATION: the SHA is no longer validated.`,
    test: 'tests/unit/isolation-paths.test.ts',
  },
  {
    name: 'the key is no longer validated',
    file: 'packages/isolation/src/t1/paths.ts',
    search: `  if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    return {
      ok: false,
      reason: \`the key "\${key}" contains characters that are not safe in a directory name\`,
    };
  }`,
    replace: `  // MUTATION: the key is no longer validated.`,
    test: 'tests/unit/isolation-paths.test.ts',
  },

  // ---- the git invocation ---------------------------------------------
  {
    name: 'the hooks are no longer disabled',
    file: 'packages/isolation/src/t1/snapshot.ts',
    search: `export const CANONICAL_GIT_CONFIG: readonly string[] = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
];`,
    replace: `export const CANONICAL_GIT_CONFIG: readonly string[] = [
  '-c',
  'core.fsmonitor=false',
];`,
    test: 'tests/unit/isolation-worktree.test.ts',
  },
  {
    name: 'the fsmonitor is no longer disabled',
    file: 'packages/isolation/src/t1/snapshot.ts',
    search: `  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
];`,
    replace: `  '-c',
  'core.hooksPath=/dev/null',
];`,
    test: 'tests/unit/isolation-worktree.test.ts',
  },
  {
    name: 'the worktree’s git invocation drops the canonical flags',
    file: 'packages/isolation/src/t1/worktree.ts',
    search: `    return [
      'git',
      ...CANONICAL_GIT_CONFIG,
      'worktree',
      'add',`,
    replace: `    return [
      'git',
      'worktree',
      'add',`,
    test: 'tests/unit/isolation-worktree.test.ts',
  },
  {
    name: 'the worktree’s removal drops the canonical flags',
    file: 'packages/isolation/src/t1/worktree.ts',
    search: `    return [
      'git',
      ...CANONICAL_GIT_CONFIG,
      'worktree',
      'remove',`,
    replace: `    return [
      'git',
      'worktree',
      'remove',`,
    test: 'tests/unit/isolation-worktree.test.ts',
  },
  {
    name: 'the snapshot archives a SHA other than the one it was asked for',
    file: 'packages/isolation/src/t1/snapshot.ts',
    search: `      'archive',
      '--format=tar',
      baseSha,
    ];`,
    replace: `      'archive',
      '--format=tar',
      'HEAD',
    ];`,
    test: 'tests/unit/isolation-snapshot.test.ts',
  },
  {
    name: 'the worktree is created from a SHA other than the one it was asked for',
    file: 'packages/isolation/src/t1/worktree.ts',
    search: `      'worktree',
      'add',
      '--detach',
      target,
      baseSha,
    ];`,
    replace: `      'worktree',
      'add',
      '--detach',
      target,
      'HEAD',
    ];`,
    test: 'tests/unit/isolation-worktree.test.ts',
  },
  {
    name: 'the base SHA is no longer refused before git runs',
    file: 'packages/isolation/src/t1/snapshot.ts',
    search: `    const sha = checkSha(baseSha);
    if (!sha.ok) {
      return { ok: false, reason: sha.reason };
    }`,
    replace: `    // MUTATION: the SHA is no longer refused.`,
    test: 'tests/unit/isolation-snapshot.test.ts',
  },

  // ---- the extraction --------------------------------------------------
  {
    name: 'a member that escapes the root is no longer refused',
    file: 'packages/isolation/src/t1/snapshot.ts',
    search: `      const target = resolveInside(root, member.name);
      if (!target.ok) {
        return {
          ok: false,
          reason: \`the archive member "\${member.name}" is not inside the snapshot: \${target.reason}\`,
        };
      }

      if (member.type === 'symlink') {`,
    replace: `      const target = resolveInside(root, member.name);
      if (false) {
        return {
          ok: false,
          reason: \`the archive member "\${member.name}" is not inside the snapshot: \${target.reason}\`,
        };
      }

      if (member.type === 'symlink') {`,
    test: 'tests/unit/isolation-snapshot.test.ts',
  },
  {
    name: 'a symlink whose target escapes is no longer refused',
    file: 'packages/isolation/src/t1/snapshot.ts',
    search: `        const link = resolveLinkTarget(root, member.name, member.target);
        if (!link.ok) {
          return {
            ok: false,
            reason: \`the archive member "\${member.name}" is not safe: \${link.reason}\`,
          };
        }`,
    replace: `        const link = resolveLinkTarget(root, member.name, member.target);
        if (false) {
          return {
            ok: false,
            reason: \`the archive member "\${member.name}" is not safe: \${link.reason}\`,
          };
        }`,
    test: 'tests/unit/isolation-snapshot.test.ts',
  },
  {
    name: 'a hard link is no longer refused',
    file: 'packages/isolation/src/t1/snapshot.ts',
    search: `      if (member.type === 'hardlink') {
        return {
          ok: false,
          reason:
            \`the archive contains the hard link "\${member.name}", which is not permitted in a snapshot\`,
        };
      }`,
    replace: `      // MUTATION: the hard link is no longer refused.`,
    test: 'tests/unit/isolation-snapshot.test.ts',
  },
  {
    name: 'the archive is written member by member, so a hostile one leaves a partial snapshot',
    file: 'packages/isolation/src/t1/snapshot.ts',
    search: `    // **Pass one — decide.** Every member is checked before anything is
    // written, so a hostile archive never leaves a partial snapshot behind.
    for (const member of members) {`,
    replace: `    // MUTATION: pass one is gone — the members are written as they are
    // read, so a hostile archive leaves a partial snapshot behind.
    for (const member of members) {
      const written = resolveInside(root, member.name);
      if (written.ok && member.type === 'file') {
        await this.#options.store.ensureDir(root);
        await this.#options.store.writeFile(written.path, member.contents);
        continue;
      }
      if (written.ok && member.type === 'hardlink') {
        await this.#options.store.ensureDir(root);
        continue;
      }`,
    test: 'tests/unit/isolation-snapshot.test.ts',
  },

  // ---- the reclamation -------------------------------------------------
  {
    name: 'the terminal states stop reclaiming',
    file: 'packages/isolation/src/t1/reclaim.ts',
    search: `      if (!isTerminal(state)) {
        // \`ESCALATED\` lands here: resumable, so it keeps its workspace.
        continue;
      }`,
    replace: `      if (state === undefined) {
        // MUTATION: the terminal check is gone.
        continue;
      }`,
    test: 'tests/unit/isolation-a0-9.test.ts',
  },
  {
    name: 'the terminal check is inverted — a resumable task is reclaimed',
    file: 'packages/isolation/src/t1/reclaim.ts',
    search: `      if (!isTerminal(state)) {
        // \`ESCALATED\` lands here: resumable, so it keeps its workspace.
        continue;
      }`,
    replace: `      if (isTerminal(state)) {
        // MUTATION: the check is inverted.
        continue;
      }`,
    test: 'tests/unit/isolation-a0-9.test.ts',
  },
  {
    name: 'the directory is not removed — only the record is forgotten',
    file: 'packages/isolation/src/t1/reclaim.ts',
    search: `      if (await this.#options.store.exists(workspace.root)) {
        await this.#options.store.remove(workspace.root);
      }`,
    replace: `      // MUTATION: the directory is never removed.`,
    test: 'tests/unit/isolation-a0-9.test.ts',
  },
  {
    name: 'the record is not forgotten — a reclaimed workspace stays recorded',
    file: 'packages/isolation/src/t1/reclaim.ts',
    search: `    try {
      await this.#options.registry.forget(workspace.root);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
    return undefined;`,
    replace: `    // MUTATION: the record is never forgotten.
    return undefined;`,
    test: 'tests/unit/isolation-a0-9.test.ts',
  },
  {
    name: 'a failed removal is reported as a success',
    file: 'packages/isolation/src/t1/reclaim.ts',
    search: `    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }

    try {
      await this.#options.registry.forget(workspace.root);`,
    replace: `    } catch (error) {
      // MUTATION: the failure is swallowed.
      void error;
    }

    try {
      await this.#options.registry.forget(workspace.root);`,
    test: 'tests/unit/isolation-a0-9.test.ts',
  },

  // ---- the leak detector ------------------------------------------------
  {
    name: 'the detector stops reporting a workspace whose task has gone terminal',
    file: 'packages/isolation/src/t1/reclaim.ts',
    search: `      const state = await this.#options.stateOf(workspace.taskId);
      if (state === undefined || isTerminal(state)) {
        leaks.push({`,
    replace: `      const state = await this.#options.stateOf(workspace.taskId);
      if (false) {
        leaks.push({`,
    test: 'tests/unit/isolation-a0-9.test.ts',
  },
  {
    name: 'the detector stops reporting a directory the registry does not know about',
    file: 'packages/isolation/src/t1/reclaim.ts',
    search: `        const root = \`\${this.#options.root}/\${name}\`;
        if (known.has(root)) {
          continue;
        }`,
    replace: `        const root = \`\${this.#options.root}/\${name}\`;
        if (true) {
          continue;
        }`,
    test: 'tests/unit/isolation-a0-9.test.ts',
  },
];

/**
 * Did the named test file fail?
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
