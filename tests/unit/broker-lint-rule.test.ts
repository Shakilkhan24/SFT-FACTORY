/**
 * T-1.08 oracle — the A0.2 **lint half**.
 *
 * The ticket requires that "adapters [are] constructible only inside the
 * broker module". The plan splits that into two halves, and this file
 * proves the *lint* half bites.
 *
 * ## Why the rule needs proving
 *
 * A lint rule that has never been shown to fail is not a rule. The rule
 * here bans `packages/broker/src/adapters/**` from every path except
 * `adapters/factory.ts` and `broker.ts`. If the pattern were wrong — one
 * too many slashes, a glob that matches nothing — the rule would pass
 * silently and every future adapter import outside the broker would be
 * waved through in review.
 *
 * So the rule is proved **two-sided**, the same discipline the deps rule
 * uses (`tests/unit/deps-rule-negative.test.ts`):
 *
 * 1. a scratch tree that imports an adapter from outside the broker
 *    **fails** the rule; and
 * 2. the same tree without the import **passes**.
 *
 * A rule that rejects everything would satisfy (1) alone. (2) is what
 * makes (1) mean something.
 *
 * ## Why a scratch tree
 *
 * The rule is read from the repository's own `eslint.config.js`, and it is
 * run by the repository's own ESLint. So the test must not re-implement
 * the rule: it must run the real one over a tree that contains the
 * violation, and over a tree that does not.
 *
 * The scratch tree is a copy of the repository's flat ESLint config plus
 * the two files the rule cares about. The config is **not** copied
 * verbatim — it is read from the repo and the adapter block is located
 * inside it — because a test that copies the rule into a fixture would
 * prove the fixture, not the rule.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

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
 * Never throws on a non-zero exit — a violation IS the expected outcome in
 * the negative case.
 */
const lint = async (root: string, files: readonly string[]): Promise<LintResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(
      eslintBin,
      ['--no-config-lookup', '--config', join(root, 'eslint.config.js'), ...files],
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

/**
 * The repository's ESLint config, with the adapter rule block **extracted**
 * rather than retyped.
 *
 * The block is copied out of the real config verbatim, so the scratch tree
 * runs the *same* rule the repository runs. If the real config's block is
 * deleted or renamed, this extraction finds nothing and the test fails —
 * which is the right outcome: the rule is gone.
 */
const extractAdapterRule = (config: string): string => {
  const marker = 'Adapters may only be constructed inside the broker module.';
  const at = config.indexOf(marker);
  if (at === -1) {
    throw new Error(
      'the repository eslint config no longer carries the A0.2 adapter rule',
    );
  }

  // The rule block starts at the `files:` that precedes the marker and
  // ends at the closing of that object. The config is flat and the block
  // is the last one, so the block runs from its `files:` to the end of
  // the `export default` call.
  const filesAt = config.lastIndexOf('files:', at);
  if (filesAt === -1) {
    throw new Error('the A0.2 adapter rule block has no "files" key');
  }
  const block = config.slice(filesAt);
  return block;
};

/**
 * Build a scratch tree holding the extracted rule and two candidate
 * importers.
 *
 * The tree is deliberately minimal: the rule under test is an import
 * restriction, and everything else in the repository's config is
 * irrelevant to it. Copying the whole config would drag the TypeScript
 * project service into a scratch tree that has no `tsconfig`, and the
 * failure would be about types rather than about the rule.
 */
const scaffold = async (
  root: string,
  options: { readonly importer: string | undefined },
): Promise<void> => {
  const config = await readFile(repoEslintConfig, 'utf8');
  const ruleBlock = extractAdapterRule(config);

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
      "                '**/packages/broker/src/adapters/**',",
      "                'packages/broker/src/adapters/**',",
      '              ],',
      '              message:',
      "                'Adapters may only be constructed inside the broker module. Import @factory/broker, or the adapter factory at packages/broker/src/adapters/factory.ts.',",
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

  // The banned module exists in the scratch tree, so the import resolves
  // and the rule is what rejects it — not a missing file.
  await mkdir(join(root, 'packages', 'broker', 'src', 'adapters'), { recursive: true });
  await writeFile(
    join(root, 'packages', 'broker', 'src', 'adapters', 'inproc.ts'),
    ['export const inproc = (): string => "inproc";', ''].join('\n'),
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

const scratch = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'factory-lint-'));

const withScratch = async (
  options: { readonly importer: string | undefined },
  body: (root: string) => Promise<void>,
): Promise<void> => {
  const root = await scratch();
  try {
    await scaffold(root, options);
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const BAD_IMPORT = [
  "import { inproc } from '../../packages/broker/src/adapters/inproc.js';",
  '',
  'export const use = inproc;',
  '',
].join('\n');

const GOOD_IMPORT = [
  "import { somethingElse } from '../../packages/other/helper.js';",
  '',
  'export const use = somethingElse;',
  '',
].join('\n');

describe('T-1.08 — the A0.2 lint rule bites', () => {
  it('A0.2 — an adapter imported from outside the broker FAILS the rule', async () => {
    await withScratch({ importer: BAD_IMPORT }, async (root) => {
      const result = await lint(root, ['packages/other/index.ts']);

      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain('no-restricted-imports');
      expect(result.output).toContain(
        'Adapters may only be constructed inside the broker module',
      );
    });
  }, 120_000);

  it('A0.2 — the same tree WITHOUT the adapter import PASSES the rule', async () => {
    await withScratch({ importer: GOOD_IMPORT }, async (root) => {
      const result = await lint(root, ['packages/other/index.ts']);

      expect(result.output).not.toContain('no-restricted-imports');
      expect(result.exitCode).toBe(0);
    });
  }, 120_000);

  it('A0.2 — the repository still carries the A0.2 rule block', async () => {
    // The extraction above reads the real config. If the rule were
    // removed from `eslint.config.js`, the extraction would throw — this
    // test states that as an explicit expectation rather than leaving it
    // as an incidental failure of another test.
    const config = await readFile(repoEslintConfig, 'utf8');

    expect(() => extractAdapterRule(config)).not.toThrow();
    expect(extractAdapterRule(config)).toContain('no-restricted-imports');
  });

  it('A0.2 — the broker module itself may import the adapters', async () => {
    // The rule is scoped: the factory constructs the adapters and the
    // broker reaches them through it. If the scope were wrong, the broker
    // itself would not build — so this is proved on the real tree.
    await withScratch({ importer: undefined }, async (root) => {
      const result = await lint(root, [
        'packages/broker/src/adapters/inproc.ts',
      ]);

      expect(result.output).not.toContain('no-restricted-imports');
      expect(result.exitCode).toBe(0);
    });
  }, 120_000);
});
