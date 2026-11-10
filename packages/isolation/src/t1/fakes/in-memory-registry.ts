/**
 * `t1/fakes/in-memory-registry` — the registry double.
 *
 * The registry is the **durable record** of the workspaces that exist, so
 * its double is a map. The double records the calls as well as the state,
 * so a test can assert that `forget` was called for the workspace it
 * expected — and, more importantly, assert that `forget` was **not** called
 * for a workspace that should have been kept.
 */

import type { SnapshotRegistry, Workspace } from '../ports.js';

export class InMemorySnapshotRegistry implements SnapshotRegistry {
  readonly #rows = new Map<string, Workspace>();

  /** The roots that were forgotten, in order. */
  public readonly forgotten: string[] = [];

  public record(workspace: Workspace): Promise<void> {
    this.#rows.set(workspace.root, workspace);
    return Promise.resolve();
  }

  public list(taskId?: string): Promise<readonly Workspace[]> {
    const all = [...this.#rows.values()];
    const selected =
      taskId === undefined ? all : all.filter((row) => row.taskId === taskId);
    return Promise.resolve(selected);
  }

  public forget(root: string): Promise<void> {
    this.forgotten.push(root);
    this.#rows.delete(root);
    return Promise.resolve();
  }
}
