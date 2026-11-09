/**
 * T-1.05 — the NEGATIVE dependency test for the policy package.
 *
 * checklist 02 T-1.05's exit criteria include "**the package has no I/O
 * imports**", and the ticket says: "**Pure:** no `node:fs/net/child_process`,
 * no `pg`, no network, no clock, no randomness except injected. Enforced by
 * `pnpm lint:deps`."
 *
 * A dependency rule that has never been shown to fail is not a rule
 * (checklist 01 trap 6). This test proves the rule bites **for this
 * package**, in two ways:
 *
 *  1. by running the REAL dependency-cruiser over a scratch workspace that
 *     contains the violation — so the actual rule, not a copy of it, is what
 *     rejects the code; and
 *  2. by running the same rule over the same scratch tree WITHOUT the
 *     violation, to prove the rule is not simply failing on everything.
 *
 * The scratch tree is a real npm workspace with the `node_modules/@factory/*`
 * symlinks that make a cross-package import resolve. Without those links
 * dependency-cruiser cannot resolve the import target and the rule never
 * sees it — which would make the negative test pass for the wrong reason.
 *
 * The test id follows the identifier rule from A1 §3: the display name
 * carries the id verbatim, the function name carries it in identifier-safe
 * form.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(import.meta.dirname, '..', '..');
const depcruiseConfig = join(repoRoot, '.dependency-cruiser.json');
const depcruiseBin = join(repoRoot, 'node_modules', '.bin', 'depcruise');

interface CruiseResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Run dependency-cruiser with the repository's own config and report what
 * happened. Never throws on a non-zero exit — a violation IS the expected
 * outcome in the negative case.
 */
const cruise = async (root: string): Promise<CruiseResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(
      depcruiseBin,
      ['--config', depcruiseConfig, '.'],
      { cwd: root },
    );
    return { exitCode: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failure.code ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
};

interface WorkspaceMember {
  /** The package directory relative to the workspace root. */
  readonly dir: string;
  /** The published package name. */
  readonly name: string;
  /** The contents of `src/index.ts`. */
  readonly source: string;
}

const pkgJson = (name: string): string =>
  JSON.stringify(
    {
      name,
      version: '0.0.0',
      private: true,
      type: 'module',
      main: './src/index.ts',
      types: './src/index.ts',
      exports: { '.': './src/index.ts' },
    },
    null,
    2,
  );

/**
 * Build a real npm workspace on disk, with the `node_modules/@factory/*`
 * symlinks that make cross-package imports resolvable.
 */
const scaffold = async (
  root: string,
  members: readonly WorkspaceMember[],
): Promise<void> => {
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'scratch-workspace',
        private: true,
        type: 'module',
        workspaces: ['packages/*', 'apps/*'],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
        },
        include: ['packages/**/*.ts', 'apps/**/*.ts'],
      },
      null,
      2,
    ),
    'utf8',
  );

  for (const member of members) {
    const dir = join(root, member.dir);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'package.json'), pkgJson(member.name), 'utf8');
    await writeFile(join(dir, 'src', 'index.ts'), member.source, 'utf8');
  }

  const scopeDir = join(root, 'node_modules', '@factory');
  await mkdir(scopeDir, { recursive: true });
  for (const member of members) {
    const linkPath = join(scopeDir, member.name.replace('@factory/', ''));
    await symlink(join(root, member.dir), linkPath, 'dir');
  }
};

const withScratch = async (
  members: readonly WorkspaceMember[],
  body: (root: string) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'factory-policy-deps-'));
  try {
    await scaffold(root, members);
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe('T-1.05 · the policy package is pure, and the rule bites', () => {
  it('A1.46 — a policy package importing node:fs FAILS the deps rule', async () => {
    await withScratch(
      [
        {
          dir: 'packages/policy',
          name: '@factory/policy',
          source: [
            "import { readFileSync } from 'node:fs';",
            '',
            'export const read = (p: string): string => readFileSync(p, "utf8");',
            '',
          ].join('\n'),
        },
      ],
      async (root) => {
        const result = await cruise(root);

        expect(result.exitCode).not.toBe(0);
        expect(result.output).toContain('pure-packages-have-no-io');
      },
    );
  }, 120_000);

  it('A1.46 — the same tree WITHOUT the violation PASSES the deps rule', async () => {
    await withScratch(
      [
        {
          dir: 'packages/policy',
          name: '@factory/policy',
          source: ['export const read = (p: string): string => p;', ''].join('\n'),
        },
      ],
      async (root) => {
        const result = await cruise(root);

        expect(result.output).not.toContain('pure-packages-have-no-io');
        expect(result.exitCode).toBe(0);
      },
    );
  }, 120_000);

  it('A1.46 — a policy package importing pg FAILS the deps rule', async () => {
    await withScratch(
      [
        {
          dir: 'packages/policy',
          name: '@factory/policy',
          source: [
            "import { Pool } from 'pg';",
            '',
            'export const pool = (): Pool => new Pool();',
            '',
          ].join('\n'),
        },
      ],
      async (root) => {
        const result = await cruise(root);

        expect(result.exitCode).not.toBe(0);
        expect(result.output).toContain('pure-packages-no-external-dependencies');
      },
    );
  }, 120_000);

  it('A1.46 — a policy package importing the db package FAILS the deps rule', async () => {
    await withScratch(
      [
        {
          dir: 'packages/policy',
          name: '@factory/policy',
          source: [
            "import { repo } from '@factory/db';",
            '',
            'export const r = repo;',
            '',
          ].join('\n'),
        },
        {
          dir: 'packages/db',
          name: '@factory/db',
          source: ['export const repo = (): string => "repo";', ''].join('\n'),
        },
      ],
      async (root) => {
        const result = await cruise(root);

        expect(result.exitCode).not.toBe(0);
        expect(result.output).toContain('pure-packages-have-no-db-client');
      },
    );
  }, 120_000);

  it('A1.46 — a policy package importing node:net FAILS the deps rule', async () => {
    // The rule bans the whole network surface, not just `fs`. A policy
    // engine that could make a network call could leak the action it is
    // evaluating — and the action's resource is often a private host.
    await withScratch(
      [
        {
          dir: 'packages/policy',
          name: '@factory/policy',
          source: [
            "import { request } from 'node:https';",
            '',
            'export const r = request;',
            '',
          ].join('\n'),
        },
      ],
      async (root) => {
        const result = await cruise(root);

        expect(result.exitCode).not.toBe(0);
        expect(result.output).toContain('pure-packages-have-no-io');
      },
    );
  }, 120_000);
});
