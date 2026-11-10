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
