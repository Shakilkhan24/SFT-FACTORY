/**
 * `t1/fakes/in-memory-store` — the filesystem double.
 *
 * The double is a **map of paths to contents**, so a test can assert that
 * the snapshot's files landed inside the root — and, more importantly,
 * that a hostile archive's member landed **nowhere**.
 *
 * The removals are recorded, so a test can assert that reclamation
 * actually removed the directory rather than merely forgetting the record.
 *
 * ## It behaves like a filesystem
 *
 * `ensureDir` creates the **parents** too, as `mkdir -p` does, and
 * `writeFile` creates the file's parent directory, as writing a file
 * does. Without that, a test that creates `/snapshots/w1` would have a
 * directory with no parent, and a `readDir('/snapshots')` would find
 * nothing — which would make the leak detector's "a directory the
 * registry does not know about" case **impossible to construct**, and a
 * check that cannot be constructed is a check that proves nothing.
 */

import type { WorkspaceStore } from '../ports.js';

export class InMemoryWorkspaceStore implements WorkspaceStore {
  /** The files, by absolute path. */
  public readonly files = new Map<string, Uint8Array>();

  /** The directories, by absolute path. */
  public readonly directories = new Set<string>();

  /** The roots that were removed, in order. */
  public readonly removed: string[] = [];

  public ensureDir(path: string): Promise<void> {
    this.#mkdirp(path);
    return Promise.resolve();
  }

  public exists(path: string): Promise<boolean> {
    return Promise.resolve(
      this.files.has(path) || this.directories.has(path),
    );
  }

  public writeFile(path: string, contents: Uint8Array): Promise<void> {
    const slash = path.lastIndexOf('/');
    if (slash > 0) {
      this.#mkdirp(path.slice(0, slash));
    }
    this.files.set(path, contents);
    return Promise.resolve();
  }

  public remove(path: string): Promise<void> {
    this.removed.push(path);
    this.directories.delete(path);
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) {
        this.files.delete(key);
      }
    }
    // A removed directory takes its subdirectories with it.
    for (const key of [...this.directories]) {
      if (key.startsWith(`${path}/`)) {
        this.directories.delete(key);
      }
    }
    return Promise.resolve();
  }

  public readDir(path: string): Promise<readonly string[] | undefined> {
    if (!this.directories.has(path)) {
      return Promise.resolve(undefined);
    }
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.directories]) {
      if (!key.startsWith(`${path}/`)) {
        continue;
      }
      const rest = key.slice(path.length + 1);
      const head = rest.split('/')[0];
      if (head !== undefined && head.length > 0) {
        names.add(head);
      }
    }
    return Promise.resolve([...names]);
  }

  /**
   * Create a directory and every missing parent.
   */
  #mkdirp(path: string): void {
    const parts = path.split('/').filter((part) => part.length > 0);
    let current = '';
    for (const part of parts) {
      current = `${current}/${part}`;
      this.directories.add(current);
    }
    if (path.length > 0) {
      this.directories.add(path);
    }
  }
}
