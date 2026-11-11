#!/usr/bin/env node
/**
 * `factory` — the process entry point.
 *
 * ## Why this file exists
 *
 * `index.ts` exports `main()`, and the tests import `run()` and call it
 * directly — that is how the CLI is tested **without** a process. But a
 * *command* is not a function: pack `04` §"Command catalogue" names
 * `factory doctor`, `factory audit chain <taskId>` and so on as commands
 * an operator types, and two G1 rows name them as the **verify command**
 * for a gate:
 *
 * > **CL-G1-14** | `factory doctor` passes locally | output attached
 * > **CL-G1-12** | Event hash chain verifies on the hello-task run |
 * > `factory audit chain <taskId>` exit 0
 *
 * A gate row that names a command needs that command to **exist and run**.
 * `index.ts` alone does not: it exports `main()` and nothing calls it, so
 * there was no `factory` on the path.
 *
 * This file is the missing half — it does nothing but call `main()`, and
 * it is the file the `bin` entry points at.
 *
 * ## Why the import of `index.js` is **dynamic**
 *
 * `index.ts` imports the workspace packages, and every workspace package
 * declares its entry as `./src/index.ts` — which is right for TypeScript
 * and Vitest, and wrong for a **built** artifact (the source's own
 * `./connection.js` specifiers are not rewritten by Node). The fix is the
 * resolution hook in `workspace-resolver.ts`, which redirects `@factory/*`
 * to the compiled `dist/` output.
 *
 * A hook must be installed **before** the specifiers it redirects are
 * resolved, and ES module *static* imports are resolved before the
 * importing module's body runs. So a static `import { main } from
 * './index.js'` would resolve `@factory/db` too early — the hook would be
 * installed after the damage. The dynamic `await import('./index.js')`
 * below is therefore **load-bearing**, not a style choice.
 *
 * The alternative — a static import plus a `--import` flag on the command
 * line — would push the requirement onto the operator: `factory` would
 * only work if they remembered a flag. A command that needs a flag to
 * start is not a command.
 *
 * ## The error handling
 *
 * `main()` reports its own failures through `CliResult.exitCode`, and
 * sets `process.exitCode` itself. So this file's job is only to make
 * sure an **unexpected** throw still produces a non-zero exit and a
 * readable message — a stack trace on a terminal is not an operator
 * report, but a silent exit 0 would be a lie.
 */

import { registerWorkspaceResolver } from './workspace-resolver.js';

registerWorkspaceResolver();

const { main } = await import('./index.js');

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`factory: ${message}`);
  process.exitCode = 1;
});
