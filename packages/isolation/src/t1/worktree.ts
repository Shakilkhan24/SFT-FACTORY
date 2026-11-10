/**
 * `t1/worktree` — **the clean worktree creator** (T-1.12).
 *
 * ## What a clean worktree is
 *
 * pack 02 §4.14, verbatim:
 *
 * > Apply to a **clean host worktree** from the base SHA with hooks
 * > disabled (`-c core.hooksPath=/dev/null -c core.fsmonitor=false`),
 * > commit as the factory identity with trailers (`Factory-Task`,
 * > `Factory-Run`, `Factory-Oracle-Sha`), push via the broker
 * > (`git.push.branch`, `factory/<taskId>-<slug>` only).
 *
 * A worktree is a **checkout** — a working tree with an index. The snapshot
 * (`snapshot.ts`) is a copy with no `.git`; the worktree is the copy that
 * can be *worked on*, and it is the tier where a change is produced.
 *
 * ## The two flags are the whole point
 *
 * `core.hooksPath=/dev/null` — the repository's hooks never run. A hook is
 * arbitrary code from the repository, and a repository the factory is
 * asked to work on is **not trusted**: the hook is exactly the "executes
 * repo code" that T1 forbids.
 *
 * `core.fsmonitor=false` — the filesystem monitor is off. It is a
 * background daemon, and a daemon that outlives the command is a process
 * that outlives the task.
 *
 * Both are set with `-c`, which applies them to **this invocation only** —
 * the repository's own `.git/config` is not modified. That matters: the
 * factory must not leave a mark on a user's repository.
 *
 * ## Why the argv is built here and exposed
 *
 * The proof that the flags are applied is a **spy assertion** on the argv
 * (the ticket's own words: *"git is invoked with hooks disabled (spy
 * assertion)"*). So `worktreeArgv` is a public method, and the test reads
 * it. If the flags were buried in a private helper, the assertion would
 * have to reach into privates.
 */

import { checkKey, checkSha, resolveInside } from './paths.js';
import { CANONICAL_GIT_CONFIG } from './snapshot.js';
import type { SpawnFunction, Workspace, WorkspaceStore } from './ports.js';

/**
 * The outcome of a worktree request.
 */
export type WorktreeOutcome =
  | { readonly ok: true; readonly root: string; readonly workspace: Workspace }
  | { readonly ok: false; readonly reason: string };

/**
 * What the worktree creator needs.
 */
export interface WorktreeCreatorOptions {
  readonly spawn: SpawnFunction;
  readonly store: WorkspaceStore;
  /** The directory worktrees are created under. */
  readonly worktreeRoot: string;
  /** The repository to create the worktree from. */
  readonly repositoryPath: string;
  /** The clock, for the workspace's `createdAt`. */
  readonly nowIso: () => string;
  /** The task the worktree belongs to. */
  readonly taskId: string;
  /**
   * The **slug** — the human-readable part of the directory name.
   *
   * It is checked as a key, because it becomes a directory name.
   */
  readonly slug: string;
}

/**
 * The creator.
 */
export class CleanWorktreeCreator {
  readonly #options: WorktreeCreatorOptions;

  constructor(options: WorktreeCreatorOptions) {
    this.#options = options;
  }

  /**
   * The argv for the `git worktree add` call.
   *
   * The canonical flags come **first**, before the subcommand, because
   * `git -c <key>=<value> <subcommand>` is git's own syntax for a
   * per-invocation setting.
   */
  public worktreeArgv(baseSha: string, target: string): readonly string[] {
    return [
      'git',
      ...CANONICAL_GIT_CONFIG,
      'worktree',
      'add',
      '--detach',
      target,
      baseSha,
    ];
  }

  /**
   * The argv for the `git worktree remove` call — the reclamation.
   */
  public removeArgv(target: string): readonly string[] {
    return [
      'git',
      ...CANONICAL_GIT_CONFIG,
      'worktree',
      'remove',
      '--force',
      target,
    ];
  }

  /**
   * Create a clean worktree at `baseSha`.
   *
   * @param baseSha the commit the worktree starts from
   */
  public async create(baseSha: string): Promise<WorktreeOutcome> {
    const sha = checkSha(baseSha);
    if (!sha.ok) {
      return { ok: false, reason: sha.reason };
    }

    const slug = checkKey(this.#options.slug);
    if (!slug.ok) {
      return { ok: false, reason: slug.reason };
    }

    const directoryName = `${baseSha}-${this.#options.slug}`;
    const name = checkKey(directoryName);
    if (!name.ok) {
      return { ok: false, reason: name.reason };
    }

    const target = `${this.#options.worktreeRoot}/${directoryName}`;
    const inside = resolveInside(this.#options.worktreeRoot, directoryName);
    if (!inside.ok) {
      return { ok: false, reason: inside.reason };
    }

    await this.#options.store.ensureDir(this.#options.worktreeRoot);

    const controller = new AbortController();
    let result;
    try {
      result = await this.#options.spawn(this.worktreeArgv(baseSha, target), {
        env: { GIT_CONFIG_NOSYSTEM: '1' },
        signal: controller.signal,
        cwd: this.#options.repositoryPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: `the git worktree could not be created: ${message}`,
      };
    }

    if (result.code !== 0) {
      const detail = result.stderr.trim();
      return {
        ok: false,
        reason:
          `the git worktree at "${baseSha}" failed with exit code ${result.code}` +
          (detail.length > 0 ? `: ${detail}` : ''),
      };
    }

    const workspace: Workspace = {
      taskId: this.#options.taskId,
      kind: 'worktree',
      root: target,
      baseSha,
      createdAt: this.#options.nowIso(),
    };

    return { ok: true, root: target, workspace };
  }

  /**
   * Remove a worktree.
   *
   * The removal is the reclamation, and it is run with the same canonical
   * flags — a removal is a git invocation, and the rule is about every
   * git invocation.
   */
  public async remove(target: string): Promise<readonly Error[]> {
    const failures: Error[] = [];
    try {
      const controller = new AbortController();
      const result = await this.#options.spawn(this.removeArgv(target), {
        env: { GIT_CONFIG_NOSYSTEM: '1' },
        signal: controller.signal,
        cwd: this.#options.repositoryPath,
      });
      if (result.code !== 0) {
        failures.push(
          new Error(
            `the git worktree removal of "${target}" failed with exit code ${result.code}`,
          ),
        );
      }
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
    return failures;
  }
}
