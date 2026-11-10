/**
 * The **snapshot builder** — `git archive`, keyed by base SHA.
 *
 * pack 02 §4.12: *"read-only repo **snapshot** (`git archive` of the base
 * SHA into a pinned directory)"*.
 *
 * The tests cover the two halves: the snapshot is taken from the base SHA
 * the caller asked for, and the extraction is **safe by construction** — a
 * member that escapes is refused, and nothing is written when it is.
 */

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_GIT_CONFIG,
  InMemoryWorkspaceStore,
  SnapshotBuilder,
  SpySpawn,
  buildTar,
} from '../../packages/isolation/src/index.ts';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

const harness = (options: { stdout?: Uint8Array; code?: number; stderr?: string } = {}) => {
  const spawn = new SpySpawn({
    ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
    ...(options.code === undefined ? {} : { code: options.code }),
    ...(options.stderr === undefined ? {} : { stderr: options.stderr }),
  });
  const store = new InMemoryWorkspaceStore();
  const builder = new SnapshotBuilder({
    spawn: spawn.spawn,
    store,
    snapshotRoot: '/snapshots',
    repositoryPath: '/repo',
    nowIso: () => '2026-11-10T00:00:00Z',
    taskId: 'task-1',
  });
  return { spawn, store, builder };
};

describe('the snapshot builder', () => {
  it('takes the snapshot at the base SHA the caller asked for', async () => {
    const { builder, spawn } = harness({
      stdout: buildTar([{ name: 'README.md', contents: 'hello' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(true);
    expect(spawn.lastArgv).toContain(SHA);
  });

  it('archives the base SHA and nothing else', async () => {
    const { builder, spawn } = harness({
      stdout: buildTar([{ name: 'README.md', contents: 'hello' }]),
    });
    await builder.create(SHA);
    const argv = spawn.lastArgv ?? [];
    // Exactly one SHA, and it is the one that was asked for.
    expect(argv.filter((token) => token === SHA)).toHaveLength(1);
    expect(argv).not.toContain(OTHER_SHA);
  });

  it('runs git with the canonical flags — hooks disabled, fsmonitor off', async () => {
    const { builder, spawn } = harness({
      stdout: buildTar([{ name: 'README.md', contents: 'hello' }]),
    });
    await builder.create(SHA);
    const argv = spawn.lastArgv ?? [];
    expect(argv).toContain('core.hooksPath=/dev/null');
    expect(argv).toContain('core.fsmonitor=false');
    expect(CANONICAL_GIT_CONFIG).toEqual([
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
    ]);
  });

  it('invokes git as an argv array, never a shell string', async () => {
    const { builder, spawn } = harness({
      stdout: buildTar([{ name: 'README.md', contents: 'hello' }]),
    });
    await builder.create(SHA);
    const argv = spawn.lastArgv ?? [];
    expect(argv[0]).toBe('git');
    // No token is a whole command line.
    for (const token of argv) {
      expect(token).not.toContain('&&');
      expect(token).not.toContain(';');
      expect(token).not.toContain('|');
    }
  });

  it('writes the archive’s files inside the snapshot root', async () => {
    const { builder, store } = harness({
      stdout: buildTar([
        { name: 'README.md', contents: 'hello' },
        { name: 'src/index.ts', contents: 'export const x = 1;' },
      ]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(true);
    expect([...store.files.keys()]).toEqual([
      `/snapshots/${SHA}/README.md`,
      `/snapshots/${SHA}/src/index.ts`,
    ]);
  });

  it('records the file count and the content hash', async () => {
    const archive = buildTar([
      { name: 'README.md', contents: 'hello' },
      { name: 'src/index.ts', contents: 'export const x = 1;' },
    ]);
    const { builder } = harness({ stdout: archive });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.snapshot.fileCount).toBe(2);
      // The content hash is a 64-hex sha256 — the same shape the `runs`
      // table's `record_sha256` column holds.
      expect(outcome.snapshot.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('gives two snapshots of the same archive the same content hash', async () => {
    const archive = buildTar([{ name: 'README.md', contents: 'hello' }]);
    const first = harness({ stdout: archive });
    const second = harness({ stdout: archive });
    const a = await first.builder.create(SHA);
    const b = await second.builder.create(SHA);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.snapshot.contentSha256).toBe(b.snapshot.contentSha256);
    }
  });

  it('refuses a base SHA that is not a commit name', async () => {
    const { builder, spawn } = harness();
    const outcome = await builder.create('HEAD');
    expect(outcome.ok).toBe(false);
    // The refusal happens **before** git is run at all.
    expect(spawn.calls).toHaveLength(0);
  });

  it('refuses a base SHA that tries to escape', async () => {
    const { builder } = harness();
    const outcome = await builder.create('../../etc/passwd');
    expect(outcome.ok).toBe(false);
  });

  it('reports a failed archive as a refusal, not a throw', async () => {
    const { builder } = harness({ code: 128, stderr: 'fatal: bad revision' });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('128');
      expect(outcome.reason).toContain('fatal: bad revision');
    }
  });

  it('names the workspace it created', async () => {
    const { builder } = harness({
      stdout: buildTar([{ name: 'README.md', contents: 'hello' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.workspace.taskId).toBe('task-1');
      expect(outcome.workspace.kind).toBe('snapshot');
      expect(outcome.workspace.baseSha).toBe(SHA);
      expect(outcome.workspace.root).toBe(`/snapshots/${SHA}`);
    }
  });
});

describe('the traversal defence', () => {
  it('refuses a member that climbs out with `..`', async () => {
    const { builder, store } = harness({
      stdout: buildTar([{ name: '../escape', contents: 'pwned' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    // Nothing was written — the refusal happens **before** the write.
    expect(store.files.size).toBe(0);
  });

  it('refuses a member that climbs out from a subdirectory', async () => {
    const { builder, store } = harness({
      stdout: buildTar([{ name: 'a/../../escape', contents: 'pwned' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    expect(store.files.size).toBe(0);
  });

  it('refuses an absolute member name', async () => {
    const { builder, store } = harness({
      stdout: buildTar([{ name: '/etc/passwd', contents: 'pwned' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    expect(store.files.size).toBe(0);
  });

  it('refuses a symlink whose target is absolute', async () => {
    // The member's *name* is innocent. The escape is in the target, and
    // no name check can see it.
    const { builder, store } = harness({
      stdout: buildTar([{ name: 'link', type: '2', target: '/etc/passwd' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    expect(store.files.size).toBe(0);
  });

  it('refuses a symlink whose target climbs out', async () => {
    const { builder, store } = harness({
      stdout: buildTar([{ name: 'link', type: '2', target: '../../escape' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    expect(store.files.size).toBe(0);
  });

  it('refuses a hard link', async () => {
    // A hard link names another member of the archive; git's archives do
    // not contain them, and one pointing outside is an escape no name
    // check can see.
    const { builder, store } = harness({
      stdout: buildTar([{ name: 'hard', type: '1', target: '/etc/passwd' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    expect(store.files.size).toBe(0);
  });

  it('refuses a hard link for the reason that it is a hard link', async () => {
    // The refusal has to name the hard link, not merely refuse. Without
    // this, a refusal for some *other* reason would satisfy the rule
    // above, and the specific check would become unobservable.
    const { builder } = harness({
      stdout: buildTar([{ name: 'hard', type: '1', target: '/etc/passwd' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('hard link');
    }
  });

  it('refuses a hard link before the snapshot root is created', async () => {
    // Pass one decides; pass two writes. A member refused in pass one
    // must leave **no** trace — not even the root directory — or a
    // caller would find an empty snapshot where it expected nothing.
    const { builder, store } = harness({
      stdout: buildTar([{ name: 'hard', type: '1', target: '/etc/passwd' }]),
    });
    await builder.create(SHA);
    expect(store.directories.has(`/snapshots/${SHA}`)).toBe(false);
  });

  it('refuses the whole archive when one member escapes', async () => {
    // A partially-extracted snapshot would be worse than none: a caller
    // cannot tell a missing file from a deliberately excluded one.
    const { builder, store } = harness({
      stdout: buildTar([
        { name: 'README.md', contents: 'hello' },
        { name: '../escape', contents: 'pwned' },
      ]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    expect(store.files.size).toBe(0);
  });

  it('leaves no snapshot root behind when a member escapes', async () => {
    // The **decide** pass runs before the **write** pass, so a hostile
    // archive is refused before the root is created. Without that, a
    // caller would find an empty snapshot where it expected nothing — and
    // an empty snapshot looks like a repository with no files.
    const { builder, store } = harness({
      stdout: buildTar([
        { name: 'README.md', contents: 'hello' },
        { name: '../escape', contents: 'pwned' },
      ]),
    });
    await builder.create(SHA);
    expect(store.directories.has(`/snapshots/${SHA}`)).toBe(false);
  });

  it('says which member escaped', async () => {
    const { builder } = harness({
      stdout: buildTar([{ name: '../escape', contents: 'pwned' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('../escape');
    }
  });

  it('accepts a symlink that stays inside the snapshot', async () => {
    const { builder } = harness({
      stdout: buildTar([
        { name: 'README.md', contents: 'hello' },
        { name: 'link', type: '2', target: 'README.md' },
      ]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(true);
  });

  it('accepts a member whose path climbs out and comes back', async () => {
    // `a/../b` does not escape, so it is allowed. A naive `includes('..')`
    // check would refuse it — and the refusal would be a false alarm, not
    // a defence.
    const { builder } = harness({
      stdout: buildTar([{ name: 'a/../README.md', contents: 'hello' }]),
    });
    const outcome = await builder.create(SHA);
    expect(outcome.ok).toBe(true);
  });
});
