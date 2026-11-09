/**
 * `definition` — loading the factory's definition documents.
 *
 * pack 02 §3: `definition` is **not** in the pure set (`policy`, `state`,
 * `context`, `review`, `merge`), because loading a definition is I/O — it
 * reads files from disk. The pure packages take the *parsed* value; this
 * package turns bytes into a value.
 *
 * The one document this ticket delivers is `definition/policy-bundle.yaml`
 * (pack 03 §4.7). The loader parses the YAML, validates it against the
 * `PolicyBundle` contract, and computes the digest the decisions carry.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import yaml from 'js-yaml';

import { loadPolicyBundle, type LoadedPolicyBundle } from '@factory/policy';

/**
 * The repository's `definition/` directory.
 *
 * The path is resolved from this file's location — `packages/definition/src`
 * — so the loader works regardless of the process's working directory.
 */
export const DEFINITION_ROOT = resolve(import.meta.dirname, '..', '..', '..', 'definition');

/**
 * Parse and validate a policy bundle document.
 *
 * @param source the YAML text.
 * @returns the validated bundle and its digest.
 * @throws {ZodError} when the document is not a valid policy bundle.
 */
export const parsePolicyBundle = (source: string): LoadedPolicyBundle => {
  const parsed: unknown = yaml.load(source);
  return loadPolicyBundle(parsed);
};

/**
 * Read `definition/policy-bundle.yaml` and return the validated bundle.
 *
 * @param root the definition directory. Defaults to the repository's.
 */
export const readPolicyBundle = async (
  root: string = DEFINITION_ROOT,
): Promise<LoadedPolicyBundle> => {
  const source = await readFile(resolve(root, 'policy-bundle.yaml'), 'utf8');
  return parsePolicyBundle(source);
};

/**
 * The package's name — the scaffold's original export, kept so the
 * dependency rules and the baseline test still see the same surface.
 */
export const packageName = 'definition';
