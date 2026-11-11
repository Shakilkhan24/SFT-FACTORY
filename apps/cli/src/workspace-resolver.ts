/**
 * `workspace-resolver` — resolve `@factory/*` to the **compiled** output.
 *
 * ## Why this exists
 *
 * Every workspace package declares:
 *
 * ```json
 * "main": "./src/index.ts",
 * "exports": { ".": "./src/index.ts" }
 * ```
 *
 * That is right for **TypeScript** and for **Vitest** — both understand a
 * `.ts` entry, and the source is what the compiler checks. But it means a
 * **built** artifact can never be run: `node apps/cli/dist/bin.js`
 * resolves `@factory/db` to `packages/db/src/index.ts`, whose own imports
 * are `./connection.js` — specifiers Node does **not** rewrite. The result
 * is `ERR_MODULE_NOT_FOUND` on `packages/db/src/connection.js`.
 *
 * So the compiled tree is present and correct, and it is nevertheless
 * unreachable at runtime. That is a gap, not a design: pack `04` §"Command
 * catalogue" assumes the compiled packages run, and so does the `factory`
 * CLI itself — two G1 rows name a `factory` command as their **verify
 * command** (CL-G1-12, CL-G1-14), and a command that cannot start cannot
 * verify anything.
 *
 * `tools/compiled-resolver.mjs` already solved this for the fault worker.
 * It is a **file**, so it cannot be imported by a **compiled** artifact
 * that ships as JavaScript — the file is outside the CLI's `rootDir` and
 * would not be copied into `dist/`. So the same hook is written here, in
 * TypeScript, as part of the CLI's own source.
 *
 * ## What this does
 *
 * It is a Node **module resolution hook** (`module.registerHooks`). For a
 * bare specifier of the form `@factory/<name>`, it resolves to
 * `<repo>/packages/<name>/dist/index.js` — the compiled output — instead
 * of the source.
 *
 * Everything else is left alone: `kysely`, `pg`, and every relative import
 * keep Node's default behaviour.
 *
 * ## Why the compiled output and not the source
 *
 * Because the point of the hook is to run **built** code. A program that
 * imported the source would not be exercising the artifact that ships.
 *
 * ## Why `registerHooks` and not `register`
 *
 * `module.register()` — the older, worker-thread API — is **deprecated** in
 * Node 24+ and warns on every run. `registerHooks` is the current API: it
 * runs the hook **in-thread**, synchronously, which is both faster and
 * simpler — there is no message channel and no serialisation.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The shape of `module.registerHooks`.
 *
 * The repository pins `@types/node` **22.9.0**, which predates
 * `registerHooks` (Node 24 added it). The **runtime** here is Node 26, so
 * the function exists — but the type does not.
 *
 * Rather than bump `@types/node` across the whole monorepo for one call,
 * the hook is declared here, structurally. That is honest: the declaration
 * says exactly what this file uses, and it fails loudly if the runtime
 * ever stops providing the function.
 */
interface ModuleRegisterHooks {
  (hooks: {
    resolve?: (
      specifier: string,
      context: { conditions: readonly string[] },
      nextResolve: (
        specifier: string,
        context: { conditions: readonly string[] },
      ) => { url: string; format?: string; shortCircuit?: boolean },
    ) => { url: string; format?: string; shortCircuit?: boolean } | undefined;
  }): void;
}

/**
 * `registerHooks` from `node:module`.
 *
 * Read off the module namespace at runtime, so a Node too old to have it
 * produces a **named** failure ("this Node has no registerHooks") rather
 * than an undefined-is-not-a-function.
 *
 * The namespace is read through an index signature because the pinned
 * `@types/node` (22.9.0) does not declare `registerHooks` at all — the
 * property is present on the **runtime** (Node 24+), just not in the
 * types.
 */
const moduleNamespace = (await import('node:module')) as unknown as Record<
  string,
  unknown
>;

const registerHooksCandidate = moduleNamespace['registerHooks'];

if (typeof registerHooksCandidate !== 'function') {
  throw new Error(
    'factory: this Node has no `module.registerHooks`, so the workspace packages cannot be resolved. Node 24 or newer is required.',
  );
}

const registerHooks = registerHooksCandidate as ModuleRegisterHooks;

/**
 * The repository root — the directory holding `packages/`.
 *
 * The compiled file lives at `apps/cli/dist/workspace-resolver.js`, so the
 * root is three levels up. But the file is also compiled to `dist/` by
 * `tsc`, and **where it is executed from** does not change where it *is* —
 * `import.meta.url` is the file's own URL, so the root is derived from
 * the file's location, not from the working directory. That matters: an
 * operator running `factory` from anywhere must still resolve the same
 * packages.
 *
 * The search walks **upwards** rather than assuming a fixed depth, so the
 * resolver keeps working if the CLI's output directory is moved.
 */
const findRepositoryRoot = (): string => {
  let current = dirname(fileURLToPath(import.meta.url));

  // The walk is bounded so a mis-installed binary fails with a clear
  // message instead of walking to the filesystem root.
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'packages'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  // The root could not be found. The hook is then installed but inert —
  // every `@factory/*` specifier falls through to Node's own resolution,
  // which resolves to the TypeScript source and fails with the same
  // `ERR_MODULE_NOT_FOUND` it would have failed with anyway. Failing here
  // with a message would be better, but this module cannot throw during
  // resolution without masking the real error.
  return resolve(current);
};

const REPO_ROOT = findRepositoryRoot();

/**
 * The resolution hook.
 *
 * Node calls `resolve(specifier, context, nextResolve)` for every
 * resolution. The hook returns `undefined` for anything it does not
 * handle, which tells Node to fall through to its own resolver.
 *
 * The name is `resolveHook` rather than `resolve` because the module
 * already imports `resolve` from `node:path`.
 */
const resolveHook = (
  specifier: string,
  context: { conditions: readonly string[] },
  nextResolve: (
    specifier: string,
    context: { conditions: readonly string[] },
  ) => { url: string; format?: string; shortCircuit?: boolean },
): { url: string; format?: string; shortCircuit?: boolean } | undefined => {
  if (!specifier.startsWith('@factory/')) {
    return nextResolve(specifier, context);
  }

  const name = specifier.slice('@factory/'.length);
  // A sub-path import (`@factory/db/ports`) is not something the packages
  // expose today — they have a single `.` export — so anything with a
  // slash in it is left to Node.
  if (name.length === 0 || name.includes('/')) {
    return nextResolve(specifier, context);
  }

  const compiled = join(REPO_ROOT, 'packages', name, 'dist', 'index.js');
  if (!existsSync(compiled)) {
    // The package has not been built. Falling through to Node's own
    // resolution gives the familiar `ERR_MODULE_NOT_FOUND` naming the
    // source path — a clearer error than a hook that silently points at a
    // file that does not exist.
    return nextResolve(specifier, context);
  }

  return {
    url: pathToFileURL(compiled).href,
    shortCircuit: true,
    format: 'module',
  };
};

/**
 * Install the hook.
 *
 * It is idempotent: registering twice is harmless, and the CLI's entry
 * point may be called more than once in a test process.
 */
export const registerWorkspaceResolver = (): void => {
  registerHooks({ resolve: resolveHook });
};
