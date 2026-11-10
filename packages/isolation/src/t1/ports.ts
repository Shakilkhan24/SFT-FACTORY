/**
 * `t1/ports` — **the ports** (T-1.12).
 *
 * ## Why ports and not implementations
 *
 * Three things in T-1.12 touch the outside world, and all three are
 * injected:
 *
 * 1. **the process boundary** — `git` is run as a subprocess, so the spawn
 *    function is injected (AGENTS.md §4: *"argv arrays only, spawn
 *    injected"*);
 * 2. **the filesystem** — the snapshot root and the worktree root are
 *    directories, so the directory operations are behind a port;
 * 3. **the durable record** — the registry that says *which* workspaces
 *    exist, so reclamation can happen after a crash.
 *
 * The shape follows `packages/credentials/src/broker.ts`: the broker holds
 * a `CredentialLeaseStore` port and the lease is **the durable record**,
 * so the reaper can reclaim by lease when the task is long gone. T-1.12 is
 * the same shape, for the same reason: ADR-0006 §4 — *"Cleanup is a
 * reconciler responsibility (ADR-0001), so a crashed task's resources are
 * reclaimed rather than leaked."*
 *
 * ## What is deliberately not a port
 *
 * The **tar extraction** is not behind a port. It is the safety-critical
 * part, and a port would mean the safety could be swapped out. It is
 * implemented in `snapshot.ts` and is exercised directly by the tests.
 */

import type { TaskState } from '@factory/contracts';

/**
 * The spawn function the isolation package uses.
 *
 * It is **injected**, and its signature is deliberately narrow: an **argv
 * array**, an environment and a signal. There is no shell-string
 * parameter, so a caller cannot ask for one.
 *
 * The shape is copied from `packages/broker/src/adapters/cli.ts` — the same
 * rule, the same reason: a shell string is command injection, and the
 * arguments come from a base SHA that ultimately came from an agent.
 *
 * The **stdout** is a byte array, not a string. `git archive` produces a
 * tar stream, and a tar stream is binary: decoding it as text would
 * mangle every member whose contents are not valid UTF-8, and the
 * snapshot's contents would no longer be the commit's contents.
 */
export type SpawnFunction = (
  argv: readonly string[],
  options: {
    readonly env: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
    readonly cwd?: string;
  },
) => Promise<{
  readonly stdout: Uint8Array;
  readonly stderr: string;
  readonly code: number;
}>;

/**
 * A **snapshot** — a read-only copy of the repository at one commit.
 *
 * pack 02 §4.12: *"T1 (host, no code execution): read-only repo **snapshot**
 * (`git archive` of the base SHA into a pinned directory) for context
 * assembly and completion stages."*
 */
export interface Snapshot {
  /** The base SHA the snapshot was taken at. */
  readonly baseSha: string;
  /** The pinned directory the snapshot was extracted into. */
  readonly root: string;
  /** The SHA-256 of the archive, so the snapshot's contents are verifiable. */
  readonly contentSha256: string;
  /** How many files the archive contained. */
  readonly fileCount: number;
}

/**
 * A **workspace** — a directory the factory created and must eventually
 * reclaim.
 *
 * A snapshot is a workspace: it is a directory on the host, it is created
 * by the factory, and it is destroyed when the task ends. A clean worktree
 * is a workspace too.
 */
export interface Workspace {
  /** The task the workspace belongs to. */
  readonly taskId: string;
  /** What kind of workspace it is. */
  readonly kind: 'snapshot' | 'worktree';
  /** The directory. */
  readonly root: string;
  /** The base SHA, when the workspace is keyed by one. */
  readonly baseSha?: string;
  /** When the workspace was created (an ISO timestamp). */
  readonly createdAt: string;
}

/**
 * The **registry** — the durable record of the workspaces that exist.
 *
 * This is the record that makes reclamation possible after a crash. It is
 * a port rather than a table, because `migrations/**` is R4 and the ticket
 * does not name it (see the escalation); a later ticket provides the
 * Postgres implementation.
 */
export interface SnapshotRegistry {
  /** Record a workspace. */
  record(workspace: Workspace): Promise<void>;
  /** Every workspace, or just those of one task. */
  list(taskId?: string): Promise<readonly Workspace[]>;
  /** Forget a workspace — the record of it is gone, and it has been reclaimed. */
  forget(root: string): Promise<void>;
}

/**
 * The **filesystem** — the directory operations the package needs.
 *
 * The port exists so the *extraction* rules can be tested against a hostile
 * archive without touching a real disk, and so the reclamation can be
 * observed (a spy records that `remove` was called with the right path).
 */
export interface WorkspaceStore {
  /** Create a directory, including any missing parents. */
  ensureDir(path: string): Promise<void>;
  /** Does the path exist? */
  exists(path: string): Promise<boolean>;
  /** Write a file, creating the parent directory if needed. */
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  /** Remove a directory and everything under it. */
  remove(path: string): Promise<void>;
  /** The path's entries, or `undefined` when the path is not a directory. */
  readDir(path: string): Promise<readonly string[] | undefined>;
}

/**
 * A **leak** — a workspace that outlived its task.
 *
 * The leak detector is the A0.9 oracle's other half: reclamation is proven
 * by the reclaimer, and the *absence* of a leak is proven by the detector.
 */
export interface Leak {
  readonly taskId: string;
  readonly kind: Workspace['kind'];
  readonly root: string;
  readonly createdAt: string;
}

/**
 * The result of a reclamation sweep.
 */
export interface ReclaimResult {
  /** The workspaces that were reclaimed. */
  readonly reclaimed: readonly Workspace[];
  /** The reclaim that failed. */
  readonly failures: readonly Error[];
}

/**
 * A task's state, as the reclaimer sees it.
 *
 * `TaskState` is re-exported here so a caller of the isolation package does
 * not have to reach into `@factory/contracts` to say what a task's state is.
 */
export type { TaskState };
