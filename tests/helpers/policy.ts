/**
 * Shared fixtures for the policy engine's tests.
 *
 * The bundle used here is **pack 03 §4.7 verbatim** — the same rules as
 * `definition/policy-bundle.yaml`. The test reads the real YAML file, so
 * the tests and the shipped bundle cannot drift.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import yaml from 'js-yaml';

import { loadPolicyBundle, type LoadedPolicyBundle } from '../../packages/policy/src/index.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..');

/**
 * Load `definition/policy-bundle.yaml` from disk and validate it.
 *
 * The YAML file is the definition's source of truth; the tests read it
 * rather than rebuilding it in TypeScript, so a change to the shipped
 * bundle is a change to what the tests exercise.
 */
export const loadBundledPolicy = async (): Promise<LoadedPolicyBundle> => {
  const path = resolve(repoRoot, 'definition', 'policy-bundle.yaml');
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = yaml.load(raw);
  return loadPolicyBundle(parsed);
};
