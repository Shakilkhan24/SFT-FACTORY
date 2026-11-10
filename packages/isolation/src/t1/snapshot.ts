/**
 * `t1/snapshot` — **the snapshot builder** (T-1.12).
 *
 * ## What a snapshot is
 *
 * pack 02 §4.12, verbatim:
 *
 * > **T1** (host, no code execution): read-only repo **snapshot** (`git
 * > archive` of the base SHA into a pinned directory) for context assembly
 * > and completion stages; reclaimed at terminal state (leak detector A0.9).
 *
 * So a snapshot is a **copy of the repository at one commit**, extracted
 * into a pinned directory on the host. Nothing is executed. The T1 tier is
 * for read-only and completion stages — ADR-0020:
 *
 * > T1 (host worktree/snapshot, no code execution) for read-only/completion
 * > stages. **T2 (rootless Docker) is mandatory for any stage that executes
 * > repo code**, including verification.
 *
 * ## The ordering that matters
 *
 * The **archive is produced first**, and the extraction is **safe by
 * construction**: every member is checked *before* it is written. A member
 * that escapes is refused, and the snapshot **fails** — it does not extract
 * what it can and leave the rest. A partially-extracted snapshot would be
 * worse than no snapshot, because a caller cannot tell a missing file from
 * a file that was deliberately excluded.
 *
 * ## Why `git archive` and not a worktree
 *
 * A worktree is a **checkout** — it has a `.git` directory, and it is a
 * working tree that `git` will happily modify. A snapshot has no `.git`
 * directory, so there is no index, no config, and nothing for a stage to
 * run against. That is what "no code execution" means in practice for a
 * T1 stage: there is nothing to execute *with*.
 *
 * ## The git invocation
 *
 * argv arrays only, and the spawn is injected (AGENTS.md §4). The flags are
 * the canonical ones from pack 02 §4.14, verbatim:
 *
 * > Apply to a **clean host worktree** from the base SHA with hooks
 * > disabled (`-c core.hooksPath=/dev/null -c core.fsmonitor=false`)
 *
 * The snapshot's own `git archive` is run with the same two `-c` flags,
 * because the rule is about *any* git invocation made by the factory: a
 * repository's own hooks must never run inside the factory.
 */

import { sha256 } from '@factory/core';

import { checkKey, checkSha, resolveInside, resolveLinkTarget } from './paths.js';
import { readTar } from './tar.js';
import type {
  Snapshot,
  SpawnFunction,
  Workspace,
  WorkspaceStore,
} from './ports.js';

/**
 * The **canonical** git configuration flags (pack 02 §4.14, verbatim).
 *
 * - `core.hooksPath=/dev/null` — the repository's hooks never run.
 * - `core.fsmonitor=false` — the filesystem monitor is off, so git does not
 *   start a background daemon that outlives the command.
 */
export const CANONICAL_GIT_CONFIG: readonly string[] = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
];

/**
 * The refusal of a snapshot request.
 */
export type SnapshotRefusal =
  | { readonly ok: false; readonly reason: string };

/**
 * The outcome of a snapshot request.
 */
export type SnapshotOutcome =
  | { readonly ok: true; readonly snapshot: Snapshot; readonly workspace: Workspace }
  | SnapshotRefusal;

/**
 * What the snapshot builder needs.
 */
export interface SnapshotBuilderOptions {
  /** The injected spawn. */
  readonly spawn: SpawnFunction;
  /** The filesystem. */
  readonly store: WorkspaceStore;
  /** The directory snapshots are created under. */
  readonly snapshotRoot: string;
  /** The repository to snapshot. */
  readonly repositoryPath: string;
  /** The clock, for the workspace's `createdAt`. */
  readonly nowIso: () => string;
  /** The task the snapshot belongs to. */
  readonly taskId: string;
}

/**
 * The builder.
 */
export class SnapshotBuilder {
  readonly #options: SnapshotBuilderOptions;

  constructor(options: SnapshotBuilderOptions) {
    this.#options = options;
  }

  /**
   * The argv for the `git archive` call.
   *
   * Exposed so the test can assert on it without running git — the
   * "hooks disabled" proof is a spy assertion, and a spy needs the argv.
   */
  public archiveArgv(baseSha: string): readonly string[] {
    return [
      'git',
      ...CANONICAL_GIT_CONFIG,
      'archive',
      '--format=tar',
      baseSha,
    ];
  }

  /**
   * Take a snapshot of the repository at `baseSha`.
   *
   * @param baseSha the commit to snapshot
   */
  public async create(baseSha: string): Promise<SnapshotOutcome> {
    const sha = checkSha(baseSha);
    if (!sha.ok) {
      return { ok: false, reason: sha.reason };
    }

    // The key becomes a directory name, so it is checked as a key too.
    const key = checkKey(baseSha);
    if (!key.ok) {
      return { ok: false, reason: key.reason };
    }

    const root = `${this.#options.snapshotRoot}/${baseSha}`;
    const inside = resolveInside(this.#options.snapshotRoot, baseSha);
    if (!inside.ok) {
      return { ok: false, reason: inside.reason };
    }

    const archive = await this.#archive(baseSha);
    if (!archive.ok) {
      return archive;
    }

    const extraction = await this.#extract(root, archive.bytes);
    if (!extraction.ok) {
      return extraction;
    }

    const snapshot: Snapshot = {
      baseSha,
      root,
      contentSha256: sha256(archive.bytes),
      fileCount: extraction.fileCount,
    };

    const workspace: Workspace = {
      taskId: this.#options.taskId,
      kind: 'snapshot',
      root,
      baseSha,
      createdAt: this.#options.nowIso(),
    };

    return { ok: true, snapshot, workspace };
  }

  /**
   * Run `git archive` and capture the tar stream.
   *
   * The spawn is **injected**, so a test never shells out. A non-zero exit
   * is a refusal with git's own stderr — not a thrown error — because a
   * bad SHA is an expected outcome of a caller's mistake.
   */
  async #archive(
    baseSha: string,
  ): Promise<
    | { readonly ok: true; readonly bytes: Uint8Array }
    | { readonly ok: false; readonly reason: string }
  > {
    const controller = new AbortController();
    let result;
    try {
      result = await this.#options.spawn(this.archiveArgv(baseSha), {
        env: { GIT_CONFIG_NOSYSTEM: '1' },
        signal: controller.signal,
        cwd: this.#options.repositoryPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `the git archive could not be run: ${message}` };
    }

    if (result.code !== 0) {
      const detail = result.stderr.trim();
      return {
        ok: false,
        reason:
          `the git archive of "${baseSha}" failed with exit code ${result.code}` +
          (detail.length > 0 ? `: ${detail}` : ''),
      };
    }

    return { ok: true, bytes: result.stdout };
  }

  /**
   * Extract the archive into `root`, refusing anything that escapes.
   *
   * The refusal is decided **per member, before the member is written**.
   */
  async #extract(
    root: string,
    bytes: Uint8Array,
  ): Promise<
    | { readonly ok: true; readonly fileCount: number }
    | { readonly ok: false; readonly reason: string }
  > {
    let members;
    try {
      members = readTar(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `the archive could not be read: ${message}` };
    }

    // **Pass one — decide.** Every member is checked before anything is
    // written, so a hostile archive never leaves a partial snapshot behind.
    for (const member of members) {
      if (member.type === 'hardlink') {
        return {
          ok: false,
          reason:
            `the archive contains the hard link "${member.name}", which is not permitted in a snapshot`,
        };
      }

      const target = resolveInside(root, member.name);
      if (!target.ok) {
        return {
          ok: false,
          reason: `the archive member "${member.name}" is not inside the snapshot: ${target.reason}`,
        };
      }

      if (member.type === 'symlink') {
        const link = resolveLinkTarget(root, member.name, member.target);
        if (!link.ok) {
          return {
            ok: false,
            reason: `the archive member "${member.name}" is not safe: ${link.reason}`,
          };
        }
      }
    }

    // **Pass two — write.** Every member is known to be safe.
    await this.#options.store.ensureDir(root);
    let fileCount = 0;
    for (const member of members) {
      const target = resolveInside(root, member.name);
      // Safe by pass one; the check is repeated because the result is used
      // as a path and a path must never be used unchecked.
      if (!target.ok) {
        return {
          ok: false,
          reason: `the archive member "${member.name}" is not inside the snapshot: ${target.reason}`,
        };
      }
      if (member.type === 'directory') {
        await this.#options.store.ensureDir(target.path);
        continue;
      }
      if (member.type === 'symlink') {
        await this.#options.store.ensureDir(
          target.path.slice(0, target.path.lastIndexOf('/')),
        );
        await this.#options.store.writeFile(target.path, new Uint8Array(0));
        continue;
      }
      if (member.type !== 'file') {
        // A hard link — refused in pass one. The check is repeated so a
        // future member type cannot be written by accident.
        return {
          ok: false,
          reason: `the archive member "${member.name}" is not a file and cannot be extracted`,
        };
      }
      await this.#options.store.writeFile(target.path, member.contents);
      fileCount += 1;
    }

    return { ok: true, fileCount };
  }
}
