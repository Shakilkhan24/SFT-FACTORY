/**
 * `definition` — loading the definition from disk.
 *
 * pack 02 §3: `definition` is **not** in the pure set, because loading a
 * definition is I/O — it reads files from disk. This module is that half.
 *
 * ## The load is a *tree walk*, not a file list
 *
 * The definition is a directory of YAML documents whose filenames are not
 * part of the contract — `definition/capabilities/git-commit.yaml` and
 * `definition/capabilities/git-commit.yml` are the same document. So the
 * loader walks the tree, reads every `.yaml`/`.yml` file, and determines
 * each document's kind from its **content**.
 *
 * A file that does not parse as YAML, or that declares no kind, is a
 * **failure**, not a skip. The alternative — skipping what we cannot read —
 * is how a definition silently loses a capability and the broker then
 * refuses to call a tool the operator can see in the repository.
 *
 * ## Ordering is deterministic
 *
 * Documents are sorted by their path before validation, so the bundle's
 * digest does not depend on the order the filesystem happened to return.
 * That matters: the digest is what an approval binds to, and a digest that
 * changed because a directory listing changed would be unusable.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import yaml from 'js-yaml';

import {
  validateBundle,
  validateDocument,
  type AnyDefinitionDocument,
  type BundleValidation,
  type DefinitionBundle,
  type DocumentValidationFailure,
  type RawDocument,
} from './documents.js';

/**
 * The repository's `definition/` directory.
 *
 * Resolved from this file's location — `packages/definition/src` — so the
 * loader works regardless of the process's working directory.
 */
export const DEFINITION_ROOT = resolve(import.meta.dirname, '..', '..', '..', 'definition');

/**
 * The file extensions the loader reads.
 */
const DEFINITION_EXTENSIONS = ['.yaml', '.yml'] as const;

/**
 * A document that could not be read or parsed.
 */
export interface LoadFailure {
  readonly path: string;
  readonly reason: string;
}

/**
 * The outcome of loading a definition directory.
 */
export type LoadResult =
  | { readonly ok: true; readonly bundle: DefinitionBundle; readonly documents: readonly AnyDefinitionDocument[] }
  | { readonly ok: false; readonly failures: readonly (LoadFailure | DocumentValidationFailure)[] };

/**
 * Every YAML file under a directory, as paths relative to it, sorted.
 *
 * The sort is the point: it makes the load order — and therefore the
 * digest — independent of the filesystem's readdir order.
 */
const listDefinitionFiles = async (root: string): Promise<string[]> => {
  const found: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (DEFINITION_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
        found.push(relative(root, full));
      }
    }
  };

  await walk(root);

  // The separator is normalised so the relative paths are stable across
  // platforms — the digest must not depend on the host's path separator.
  return found.map((path) => path.split(sep).join('/')).sort();
};

/**
 * Read and parse every document under a definition directory.
 *
 * @returns the raw documents, or the files that could not be read.
 */
export const readRawDocuments = async (
  root: string = DEFINITION_ROOT,
): Promise<
  | { readonly ok: true; readonly documents: readonly RawDocument[] }
  | { readonly ok: false; readonly failures: readonly LoadFailure[] }
> => {
  const paths = await listDefinitionFiles(root);
  const documents: RawDocument[] = [];
  const failures: LoadFailure[] = [];

  for (const path of paths) {
    let source: string;
    try {
      source = await readFile(join(root, path), 'utf8');
    } catch (error) {
      failures.push({ path, reason: `the file could not be read: ${describe(error)}` });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(source);
    } catch (error) {
      failures.push({ path, reason: `the file is not valid YAML: ${describe(error)}` });
      continue;
    }

    documents.push({ path, value: parsed });
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  return { ok: true, documents };
};

/**
 * Load, validate and assemble the definition at a directory.
 *
 * @param root the definition directory.
 */
export const loadDefinition = async (root: string = DEFINITION_ROOT): Promise<LoadResult> => {
  const raw = await readRawDocuments(root);
  if (!raw.ok) {
    return { ok: false, failures: raw.failures };
  }

  const documents: AnyDefinitionDocument[] = [];
  const failures: DocumentValidationFailure[] = [];

  for (const candidate of raw.documents) {
    const validated = validateDocument(candidate);
    if (validated.ok) {
      documents.push(validated.document);
      continue;
    }
    failures.push(validated.failure);
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  const assembled: BundleValidation = validateBundle(documents);
  if (!assembled.ok) {
    return { ok: false, failures: assembled.failures };
  }

  return { ok: true, bundle: assembled.bundle, documents };
};

/**
 * Describe an error for a failure message.
 *
 * The message must not leak file contents — only the error's name and
 * message, which for a YAML parse error names the line.
 */
const describe = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);
