/**
 * Path resolution for the CLI.
 *
 * The CLI is run from the repository root in development, and from wherever it
 * is installed in production. The migration directory is therefore resolved by
 * walking up from the current working directory until a `migrations/`
 * directory is found, with the packaged copy as the fallback.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The repository root, when running from a source checkout.
 *
 * `apps/cli/src/paths.ts` → up three levels is the repository root.
 */
export const repoRoot = (): string => resolve(HERE, '..', '..', '..');

/**
 * The migrations directory.
 *
 * Resolution order:
 *  1. `FACTORY_MIGRATIONS_DIR` — an explicit override.
 *  2. the nearest `migrations/` directory at or above the working directory.
 *  3. the repository root's `migrations/` directory.
 *
 * The environment is a parameter rather than `process.env` read directly, so
 * that the CLI's `run(argv, environment)` contract holds: a caller that
 * passes an environment gets *that* environment's override, not the
 * ambient one.
 */
export const resolveMigrationDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const override = environment['FACTORY_MIGRATIONS_DIR'];
  if (override !== undefined && override !== '') {
    return resolve(override);
  }

  let current = resolve(process.cwd());
  for (;;) {
    const candidate = join(current, 'migrations');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return join(repoRoot(), 'migrations');
};

/**
 * The definition directory.
 *
 * Resolution order:
 *  1. `FACTORY_DEFINITION_DIR` — an explicit override.
 *  2. the nearest `definition/` directory at or above the working directory.
 *  3. the repository root's `definition/` directory.
 *
 * The environment is a parameter rather than `process.env` read directly, so
 * that the CLI's `run(argv, environment)` contract holds: a caller that
 * passes an environment gets *that* environment's override, not the
 * ambient one.
 */
export const resolveDefinitionDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const override = environment['FACTORY_DEFINITION_DIR'];
  if (override !== undefined && override !== '') {
    return resolve(override);
  }

  let current = resolve(process.cwd());
  for (;;) {
    const candidate = join(current, 'definition');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return join(repoRoot(), 'definition');
};

/**
 * The schemas directory — the committed JSON Schema export.
 *
 * The doctor's `schemas` check compares the committed export with what the
 * contracts produce, so it needs **both**: the directory the export lives
 * in, and the contracts' **compiled** registry to compare it against.
 *
 * The compiled registry is needed because the export is produced by
 * `tools/export-schemas.ts`, which reads `packages/contracts/dist/`. So
 * the check can only run once the contracts have been built — and it says
 * so, rather than reporting a false pass.
 *
 * Resolution order:
 *  1. `FACTORY_SCHEMAS_DIR` — an explicit override.
 *  2. the nearest `schemas/` directory at or above the working directory.
 *  3. the repository root's `schemas/` directory.
 *
 * `undefined` when there is no schemas directory at all — the caller then
 * says so, rather than the check quietly passing.
 */
export const resolveSchemasDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  const override = environment['FACTORY_SCHEMAS_DIR'];
  if (override !== undefined && override !== '') {
    return resolve(override);
  }

  let current = resolve(process.cwd());
  for (;;) {
    const candidate = join(current, 'schemas');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  const fallback = join(repoRoot(), 'schemas');
  return existsSync(fallback) ? fallback : undefined;
};

/**
 * The contracts' compiled output directory.
 *
 * `undefined` when it does not exist — the contracts have not been built,
 * and the `schemas` check says so instead of passing.
 */
export const resolveContractsDistDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  const override = environment['FACTORY_CONTRACTS_DIST_DIR'];
  if (override !== undefined && override !== '') {
    return resolve(override);
  }

  const candidate = join(repoRoot(), 'packages', 'contracts', 'dist');
  return existsSync(candidate) ? candidate : undefined;
};
