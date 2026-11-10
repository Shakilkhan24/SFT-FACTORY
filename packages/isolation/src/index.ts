/**
 * `isolation` — **the T1 isolation tier** (checklist 03, T-1.12).
 *
 * checklist 03, T-1.12:
 *
 * > **Build** `packages/isolation/t1`: `git archive` snapshots keyed by base
 * > SHA, a clean worktree creator (**hooks disabled, fsmonitor off**),
 * > reclamation + a leak detector.
 * >
 * > **Proof:** **A0.9** — reclaimed at every terminal state **including
 * > failure**; git is invoked with hooks disabled (spy assertion);
 * > traversal in a snapshot request is rejected.
 *
 * ## The tier
 *
 * ADR-0020: *"T1 (host worktree/snapshot, no code execution) for
 * read-only/completion stages. **T2 (rootless Docker) is mandatory for any
 * stage that executes repo code**, including verification."*
 *
 * So T1 is the tier where the factory reads a repository without running
 * anything in it. T2 (rootless Docker) is a later ticket.
 *
 * ## The package holds
 *
 * * the **path-safety helper** (`t1/paths.ts`) — the repository's first
 *   general path guard; a tar member that escapes is refused *before* it is
 *   written;
 * * the **tar reader** (`t1/tar.ts`) — a minimal ustar reader, so the
 *   safety is decided per member, during extraction;
 * * the **ports** (`t1/ports.ts`) — the spawn, the filesystem, the registry;
 * * the **snapshot builder** (`t1/snapshot.ts`) — `git archive`, keyed by
 *   base SHA;
 * * the **clean worktree creator** (`t1/worktree.ts`) — hooks disabled,
 *   fsmonitor off;
 * * the **reclaimer and leak detector** (`t1/reclaim.ts`) — A0.9;
 * * the **doubles** (`t1/fakes/`) — where the oracle lives.
 */

export {
  CANONICAL_GIT_CONFIG,
  SnapshotBuilder,
  type SnapshotBuilderOptions,
  type SnapshotOutcome,
  type SnapshotRefusal,
} from './t1/snapshot.js';

export {
  CleanWorktreeCreator,
  type WorktreeCreatorOptions,
  type WorktreeOutcome,
} from './t1/worktree.js';

export {
  WorkspaceReclaimer,
  type ReclaimerOptions,
} from './t1/reclaim.js';

export {
  checkKey,
  checkSha,
  isSha,
  resolveInside,
  resolveLinkTarget,
  type PathCheck,
} from './t1/paths.js';

export { readTar, TarFormatError, type TarMember } from './t1/tar.js';

export {
  type Leak,
  type ReclaimResult,
  type Snapshot,
  type SnapshotRegistry,
  type SpawnFunction,
  type TaskState,
  type Workspace,
  type WorkspaceStore,
} from './t1/ports.js';

export { InMemorySnapshotRegistry } from './t1/fakes/in-memory-registry.js';

export { InMemoryWorkspaceStore } from './t1/fakes/in-memory-store.js';

export { SpySpawn, type SpyCall, type SpySpawnOptions } from './t1/fakes/spy-spawn.js';

export { buildTar, type TarEntry } from './t1/fakes/tar-builder.js';
