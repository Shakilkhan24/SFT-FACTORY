/**
 * `tools/compiled-resolver.mjs` — resolve `@factory/*` to the **compiled** output.
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
 * **built** artifact can never be run: `node apps/cli/dist/index.js`
 * resolves `@factory/db` to `packages/db/src/index.ts`, whose own imports
 * are `./connection.js` — specifiers Node does **not** rewrite. The result
 * is `ERR_MODULE_NOT_FOUND` on `packages/db/src/connection.js`.
 *
 * So the compiled tree is present and correct, and it is nevertheless
 * unreachable at runtime. That is a gap, not a design: the pack's own
 * operational commands assume the compiled packages run, and so does the
 * `factory` CLI itself.
 *
 * ## What this does
 *
 * It is a Node **module resolution hook** (`module.registerHooks`). For a
 * bare specifier of the form `@factory/<name>`, it resolves to
 * `<repo>/packages/<name>/dist/index.js` — the compiled output — instead
 * of the source.
 *
 * Everything else is left alone: `kysely`, `pg`, `vitest`, and every
 * relative import keep Node's default behaviour.
 *
 * ## Why the compiled output and not the source
 *
 * Because the point of the hook is to run **built** code. A program that
 * imported the source would not be exercising the artifact that ships.
 *
 * ## How it is used
 *
 * ```
 * node --import ./tools/compiled-resolver.mjs ./tools/fault-worker.ts
 * ```
 *
 * The `--import` form is the one Node documents for registering hooks from
 * the command line.
 *
 * ## Why `registerHooks` and not `register`
 *
 * `module.register()` — the older, worker-thread API — is **deprecated** in
 * Node 24+ and warns on every run. `registerHooks` is the current API: it
 * runs the hook **in-thread**, synchronously, which is both faster and
 * simpler — there is no message channel and no serialisation.
 */

import { registerHooks } from 'node:module';

/**
 * The repository root — the parent of `tools/`.
 */
const REPO_ROOT = new URL('../', import.meta.url);

/**
 * The resolution hook.
 *
 * Node calls `resolve(specifier, context, nextResolve)` for every
 * resolution. The hook returns `undefined` for anything it does not
 * handle, which tells Node to fall through to its own resolver.
 */
const resolve = (specifier, context, nextResolve) => {
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

  return {
    url: new URL(`packages/${name}/dist/index.js`, REPO_ROOT).href,
    shortCircuit: true,
    format: 'module',
  };
};

registerHooks({ resolve });
