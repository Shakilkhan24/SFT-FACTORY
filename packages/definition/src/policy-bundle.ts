/**
 * `definition` — reading the policy bundle document.
 *
 * The one document checklist 02 delivered was `definition/policy-bundle.yaml`
 * (pack 03 §4.7). Checklist 03's T-1.06 generalises it: the definition
 * directory holds *many* documents, and the policy bundle is one of them.
 *
 * This module keeps the single-document loader, because the policy bundle
 * is loaded on a much hotter path than the rest of the definition — the
 * policy engine needs it on every decision — and it is convenient to load
 * just that one file.
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
