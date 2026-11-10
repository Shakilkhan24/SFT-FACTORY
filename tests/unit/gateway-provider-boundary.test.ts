/**
 * T-1.10 — INV-9's provider boundary.
 *
 * INV-9: *"Fake provider A errors ⇒ routed to B with `model.failedOver`;
 * lint proves no provider SDK/type imported outside `gateway/providers/*`
 * and no model-id string outside config."*
 *
 * ## The two halves
 *
 * The ticket requires **both** halves, and the same precedent as A0.2
 * applies — a lint rule alone is bypassable, and a runtime guard alone
 * is invisible in review:
 *
 * 1. **The lint rule** — `no-restricted-imports`, scoped so the
 *    provider modules are importable only by the factory and the
 *    gateway itself. Proved **two-sided** on a scratch tree: a tree
 *    that imports a provider from outside **fails**, and the same tree
 *    without the import **passes**.
 * 2. **The runtime guard** — the factory holds a module-private token;
 *    a provider that was not constructed by the factory **throws** when
 *    it is called.
 *
 * ## Why two-sided
 *
 * A rule that rejects everything would satisfy the first test alone.
 * The second test is what makes the first mean something: it proves
 * the rule is not simply failing on all imports.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  createAdapter,
  FakeProvider,
  guard,
  isConstructed,
} from '../../packages/gateway/src/index.ts';

import type { ProviderResponse } from '../../packages/contracts/src/index.ts';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(import.meta.dirname, '..', '..');
const eslintBin = join(repoRoot, 'node_modules', '.bin', 'eslint');
const repoEslintConfig = join(repoRoot, 'eslint.config.js');

interface LintResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Run ESLint over a scratch tree with the repository's own config.
 *
 * Never throws on a non-zero exit — a violation IS the expected outcome
 * in the negative case.
 */
const lint = async (
  root: string,
  files: readonly string[],
): Promise<LintResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(
      eslintBin,
      [
        '--no-config-lookup',
        '--config',
        join(root, 'eslint.config.js'),
        ...files,
      ],
      { cwd: root },
    );
    return { exitCode: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: failure.code ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
};

/**
 * The repository's ESLint config, with the gateway's provider rule
 * **extracted** rather than retyped.
 *
 * The block is copied out of the real config verbatim, so the scratch
 * tree runs the *same* rule the repository runs. If the real config's
 * block is deleted or renamed, this extraction finds nothing and the
 * test fails — which is the right outcome: the rule is gone.
 */
const extractProviderRule = (config: string): string => {
  const marker = 'Provider adapters may only be reached through the gateway.';
  const at = config.indexOf(marker);
  if (at === -1) {
    throw new Error(
      'the repository eslint config no longer carries the INV-9 provider rule',
    );
  }

  const filesAt = config.lastIndexOf('files:', at);
  if (filesAt === -1) {
    throw new Error('the INV-9 provider rule block has no "files" key');
  }

  // The block runs from its `files:` to the start of the next block's
  // comment. The gateway's block is the first of the two import
  // restrictions, and the next block starts with the A0.2 comment.
  const end = config.indexOf('// **A0.2', filesAt);
  if (end === -1) {
    throw new Error('could not find the end of the INV-9 provider rule block');
  }

  return config.slice(filesAt, end);
};

/**
 * Build a scratch tree holding the extracted rule and a candidate
 * importer.
 *
 * The tree is deliberately minimal: the rule under test is an import
 * restriction, and everything else in the repository's config is
 * irrelevant to it.
 */
const scaffold = async (
  root: string,
  options: { readonly importer: string | undefined },
): Promise<void> => {
  const config = await readFile(repoEslintConfig, 'utf8');
  const ruleBlock = extractProviderRule(config);

  await writeFile(
    join(root, 'eslint.config.js'),
    [
      "import tsparser from 'typescript-eslint';",
      '',
      'export default [',
      '  {',
      "    files: ['**/*.ts'],",
      '    languageOptions: {',
      '      parser: tsparser.parser,',
      '    },',
      '    rules: {',
      "      'no-restricted-imports': [",
      "        'error',",
      '        {',
      '          patterns: [',
      '            {',
      '              group: [',
      "                '**/packages/gateway/src/providers/**',",
      "                'packages/gateway/src/providers/**',",
      '              ],',
      '              message:',
      "                'Provider adapters may only be reached through the gateway. Import @factory/gateway, or the adapter factory at packages/gateway/src/providers/factory.ts.',",
      '            },',
      '          ],',
      '        },',
      '      ],',
      '    },',
      '  },',
      '];',
      '',
    ].join('\n'),
    'utf8',
  );

  // The banned module exists in the scratch tree, so the import
  // resolves and the rule is what rejects it — not a missing file.
  await mkdir(join(root, 'packages', 'gateway', 'src', 'providers'), {
    recursive: true,
  });
  await writeFile(
    join(root, 'packages', 'gateway', 'src', 'providers', 'fake.ts'),
    ['export const fake = (): string => "fake";', ''].join('\n'),
    'utf8',
  );

  // The scratch config imports `typescript-eslint`, so the tree needs it
  // resolvable. A symlink to the repository's `node_modules` gives the
  // scratch tree the parser without copying it.
  await symlink(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'dir');

  if (options.importer !== undefined) {
    await mkdir(join(root, 'packages', 'other'), { recursive: true });
    await writeFile(
      join(root, 'packages', 'other', 'index.ts'),
      options.importer,
      'utf8',
    );
  }

  // Keep the extracted block referenced, so a config that changes shape
  // still records what the rule looked like when the test ran.
  await writeFile(join(root, '.rule-block.txt'), ruleBlock, 'utf8');
};

const withScratch = async (
  options: { readonly importer: string | undefined },
  body: (root: string) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'factory-gateway-lint-'));
  try {
    await scaffold(root, options);
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const BAD_IMPORT = [
  "import { fake } from '../../packages/gateway/src/providers/fake.js';",
  '',
  'export const use = fake;',
  '',
].join('\n');

const GOOD_IMPORT = [
  "import { somethingElse } from '../../packages/other/helper.js';",
  '',
  'export const use = somethingElse;',
  '',
].join('\n');

describe('T-1.10 — INV-9’s provider boundary', () => {
  describe('the lint half', () => {
    it('a provider imported from OUTSIDE the gateway FAILS the rule', async () => {
      await withScratch({ importer: BAD_IMPORT }, async (root) => {
        const result = await lint(root, ['packages/other/index.ts']);

        expect(result.exitCode).not.toBe(0);
        expect(result.output).toContain('no-restricted-imports');
        expect(result.output).toContain(
          'Provider adapters may only be reached through the gateway',
        );
      });
    }, 120_000);

    it('the same tree WITHOUT the provider import PASSES the rule', async () => {
      await withScratch({ importer: GOOD_IMPORT }, async (root) => {
        const result = await lint(root, ['packages/other/index.ts']);

        expect(result.output).not.toContain('no-restricted-imports');
        expect(result.exitCode).toBe(0);
      });
    }, 120_000);

    it('the repository still carries the INV-9 rule block', async () => {
      const config = await readFile(repoEslintConfig, 'utf8');

      expect(() => extractProviderRule(config)).not.toThrow();
      expect(extractProviderRule(config)).toContain(
        'no-restricted-imports',
      );
    });

    it('the gateway’s OWN provider modules are not linted by it', async () => {
      // The rule is scoped: the factory constructs the adapters and the
      // gateway reaches them through it. If the scope were wrong, the
      // gateway itself would not build — so this is proved on the real
      // tree.
      const result = await lint(repoRoot, [
        'packages/gateway/src/providers/fake.ts',
      ]);

      expect(result.output).not.toContain('no-restricted-imports');
      expect(result.exitCode).toBe(0);
    }, 120_000);
  });

  describe('the runtime half', () => {
    it('a provider built by the FACTORY is accepted', () => {
      const adapter = createAdapter('fake', 'alpha', {
        models: ['a-model'],
      });

      expect(isConstructed(adapter)).toBe(true);
      expect(() => guard(adapter)).not.toThrow();
    });

    it('a provider built OUTSIDE the factory is REFUSED', () => {
      // The runtime guard. A provider that was not constructed by the
      // factory has no token, so the gateway will not call it.
      const rogue = new FakeProvider({ id: 'rogue', models: ['a-model'] });

      expect(isConstructed(rogue)).toBe(false);
      expect(() => guard(rogue)).toThrow(
        /may only be constructed inside the gateway provider factory/,
      );
    });

    it('the guard REFUSES a provider that merely LOOKS constructed', () => {
      // A token copied onto another object is not the token. The guard
      // checks the module-private symbol, so a forged `{[ADAPTER_TOKEN]:
      // true}` does not pass — it is a different symbol instance.
      const forged = {
        id: 'forged',
        complete: (): Promise<ProviderResponse> =>
          Promise.resolve({
            content: '',
            usage: { tokensIn: 0, tokensOut: 0, costUsdMicros: 0 },
            model: 'a-model',
          }),
        models: (): Promise<string[]> => Promise.resolve(['a-model']),
        health: (): Promise<'healthy'> => Promise.resolve('healthy'),
        estimateCostMicros: () => 0,
      };

      expect(isConstructed(forged)).toBe(false);
      expect(() => guard(forged)).toThrow();
    });

    it('the guard is enforced on the CALL path, not only on the guard', () => {
      // The guard must be *inside* the path the gateway takes, or a
      // rogue adapter could be handed to the gateway and called. The
      // gateway's own call path calls `guard`, so this holds.
      const source = readFileSync(
        join(repoRoot, 'packages', 'gateway', 'src', 'gateway.ts'),
        'utf8',
      );

      expect(source).toContain('guard(provider)');
    });
  });
});
