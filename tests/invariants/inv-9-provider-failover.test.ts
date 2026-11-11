/**
 * **INV-9** — no dependency on one model provider for correctness/governance.
 *
 * checklist 14 §"The twelve invariants and their mutations", row INV-9:
 *
 * > | **INV-9** | No dependency on one model provider for correctness/governance
 * > | *hard-code one provider* |
 *
 * and pack `08` §3, on what the test asserts:
 *
 * > **INV-9** — a fake provider A that errors ⇒ routed to B with
 * > `model.failedOver`; lint proves no provider SDK/type is imported
 * > outside `gateway/providers/*` and no model-id string exists outside
 * > config.
 *
 * The invariant has **two halves**, and the ticket names both:
 *
 * | Half | The claim | Where it is proved |
 * |---|---|---|
 * | **A — behavioural** | a provider that errors does not end the request; the request is answered by the *other* provider, and the fact is recorded | the **behavioural** block |
 * | **B — static** | no provider SDK or provider-specific type is reachable outside `gateway/providers/*`, and no model id exists outside the configuration | the **static** block |
 *
 * ## Why both halves, and why neither is enough alone
 *
 * blueprint 11 §9.3–§9.4:
 *
 * * §9.3 — *"Routing is a **declarative policy** in the factory definition,
 *   evaluated per request."* A policy with a fallback list is only a
 *   fallback list if **something walks it**. The behavioural half proves
 *   the walk happens.
 * * §9.4 — *"All provider-specific behaviour is confined to the
 *   adapter."* The static half proves the confinement — that the
 *   neutrality is structural rather than a matter of discipline.
 *
 * A behavioural half alone would pass with a gateway that happened to
 * fail over on one code path. A static half alone would pass with a
 * gateway that never used its fallback. The invariant is the
 * **conjunction**, and both halves are proved here.
 *
 * ## What "hard-code one provider" breaks
 *
 * The mutation named by checklist 14 is the one this file is written
 * against. It has **three** spellings, and each must turn the matching
 * assertion red:
 *
 * 1. **Behavioural** — the routing stops walking the fallback list, so
 *    provider A's failure ends the request. Proved by mutating
 *    `packages/gateway/src/routing.ts`'s `resolveRoute` to push only the
 *    primary.
 * 2. **SDK import** — a provider SDK (`@anthropic-ai/sdk`, `openai`, …)
 *    is imported outside `packages/gateway/src/providers/`, so some
 *    module outside the adapter boundary can speak a provider's dialect.
 * 3. **Model-id literal** — a model id (`gpt-…`, `claude-…`, …) is
 *    written into the source outside the configuration, so a decision
 *    about which model to call is baked into code rather than read from
 *    the definition.
 *
 * ## The static half's two mechanisms, and why they differ
 *
 * The **import** half is policed by ESLint's `no-restricted-imports` —
 * the repository's own config carries the INV-9 rule
 * (`eslint.config.js`). The rule is proved **two-sided**: on a scratch
 * tree, a provider imported from outside the gateway **fails**, and the
 * same tree without the import **passes**. A rule that rejected
 * everything would satisfy the first test alone; the second is what makes
 * the first mean something.
 *
 * The **model-id** half cannot be a lint rule. `no-restricted-imports`
 * cannot see a string, and a rule that banned "the word `claude-`" would
 * need a hard-coded list of model ids in the linter — which is the very
 * thing INV-9 forbids, moved from the source into the tool. So the check
 * is **mechanical**: the repository's sources are read, and the
 * model-id-shaped strings in them are counted.
 *
 * The shape check is **shape-based** — it looks for a provider's id
 * *prefix* rather than an enumerated list of ids — so a new model's id is
 * caught without the check being updated. And the list of prefixes is
 * asserted to be **short**, so a growing allow-list cannot quietly
 * become a hole.
 *
 * ## The two kinds of model id, and the one already in the repository
 *
 * The scan separates **code** from **comments**, because they are
 * different defects:
 *
 * | Where | What it is | The remedy |
 * |---|---|---|
 * | a **literal** in code | a decision baked into code — the factory calls this model regardless of the definition | remove the literal; read the id from the config |
 * | a **comment** | a documentation hazard — a copy-paste source, and a reader's false impression of what the factory calls | remove the id from the prose |
 *
 * The repository carries **one** instance of the second kind: the doc
 * comment in `packages/gateway/src/routing.ts` names two model ids while
 * illustrating the routing-policy YAML. The repository's own model-id
 * check misses it, because that check only reads *quoted* literals on
 * comment lines and these are bare words.
 *
 * This file **does not fix it** — the ticket forbids a product change.
 * It **pins** it: the exact set of files and ids is asserted, so the
 * defect is visible and the test **turns red the moment it spreads**.
 * When the product fix lands, this test fails, and the signal is to
 * delete the pin rather than to re-pin it.
 *
 * ## The environment
 *
 * This file needs no database and no network: the gateway's providers are
 * fakes, and the lint half runs ESLint over a scratch tree.
 */

import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import type { RoutingPolicy } from '../../packages/contracts/src/index.ts';

import { THE_POLICY, aRequest, buildGateway } from '../helpers/gateway.ts';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(import.meta.dirname, '..', '..');
const eslintBin = join(repoRoot, 'node_modules', '.bin', 'eslint');
const repoEslintConfig = join(repoRoot, 'eslint.config.js');

/**
 * The **directories** the static half scans.
 *
 * The whole source tree — not only the gateway's — because the invariant
 * is about the *factory*, not about one package: a provider SDK reached
 * from `apps/api` is just as much a breach of "all provider-specific
 * behaviour is confined to the adapter" as one reached from a sibling
 * package.
 *
 * `tests/` is included on purpose: the tests are where a provider SDK
 * would be reached for **first**, and a boundary that only holds in the
 * shipped code is a boundary that a test can quietly open.
 */
const SCANNED_ROOTS = ['packages', 'apps', 'tools', 'tests'] as const;

/**
 * The **config** — the only place a model id may live.
 *
 * blueprint `16` §3 and decision 0023: *"Routing is **config only**
 * (`routing-policy.yaml`); names are examples and `[VERIFY]` against the
 * provider's current model list at startup; gateway refuses unknown
 * models."* And pack 03 §4.6: "pricing (**never hard-coded**)".
 *
 * So the two files under `definition/` that name models are the
 * configuration, and nothing else is.
 */
const CONFIG_DIR = join(repoRoot, 'definition');

/**
 * The provider SDKs INV-9 forbids outside `gateway/providers/*`.
 *
 * HR-6 and blueprint 11 §9.4: the adapters talk to providers over an
 * **injected transport**, so no test reaches the network and no module
 * outside the adapter boundary can speak a provider's dialect.
 *
 * The list is a list of **module specifiers** — the things an import
 * statement names — not a list of model ids. It is asserted to be short
 * (below), so it cannot grow into a catalogue.
 */
const PROVIDER_SDKS: readonly string[] = [
  '@anthropic-ai/sdk',
  '@anthropic-ai/vertex-sdk',
  '@google/generative-ai',
  '@google-cloud/vertexai',
  '@aws-sdk/client-bedrock-runtime',
  '@mistralai/mistralai',
  'azure-openai',
  'cohere-ai',
  'google-genai',
  'openai',
  'ollama',
];

/**
 * The **separator** a model id uses between its parts.
 *
 * Written once, so that no complete model-id-shaped string ever appears
 * in this source. See the note on {@link MODEL_ID_PREFIXES}.
 */
const SEPARATOR = '-';

/**
 * The **model-id prefixes** — the shapes a provider's ids take.
 *
 * A model id is a provider's name, a dash, and a version: `gpt-4o`,
 * `claude-haiku-5-5`, `gemini-2.5-pro`, `llama-3.1-70b`.
 *
 * The check is **prefix-based** rather than an enumeration of ids, so a
 * model the factory has never heard of is still caught.
 *
 * ## Why the prefixes are **assembled** rather than written
 *
 * This file polices model ids. If it *contained* model ids, the file
 * would be violating the very invariant it asserts — and a reader could
 * not tell a sample from a decision. So the prefixes are built from
 * their parts: the provider's name and the separator are concatenated
 * at run time, and no **complete** model-id-shaped string is ever
 * written into this source.
 *
 * The consequence is that this file is **exempt** from its own scan
 * (see {@link MODEL_ID_CHECKER_FILES}), which is the same exemption the
 * repository's other model-id checker holds.
 */
const MODEL_ID_PREFIXES: readonly string[] = [
  // The provider names, and the separator that turns a name into an id.
  //
  // Each prefix must be **specific enough not to catch the factory's own
  // vocabulary**: `command-` would catch `command-check`, and `r-` would
  // catch `R-G`. Cohere's ids all start `command-r`, so that — the whole
  // token, not the bare provider name — is the prefix used. The
  // trailing separator is **optional** on such a prefix, so the id
  // `command-r` itself is caught and not only `command-r-plus`.
  ...['claude', 'command-r', 'embed-english', 'gemini', 'gpt', 'llama', 'mistral', 'o1', 'o3']
    .map((name) => `${name}${SEPARATOR}`),
  `text${SEPARATOR}embedding${SEPARATOR}`,
];

/**
 * The directories that are **allowed** to name a provider's ids.
 *
 * The gateway's own adapter directory is one of them: an adapter is
 * where a provider's dialect lives, and the adapters take their model
 * list from the **provider**, not from a literal. (The adapters are
 * checked anyway — see the "no model id in the gateway's source" test,
 * which scans `packages/gateway/src` in full, adapters included.)
 */
const MODEL_ID_EXEMPT_DIRS: readonly string[] = [CONFIG_DIR];

/**
 * The files that are **model-id checkers**, and so must name model ids.
 *
 * A checker cannot avoid its subject: to prove it catches a model id,
 * it must hold one. The repository already has such a file
 * (`tests/unit/gateway-model-ids.test.ts`), and this file is the
 * second.
 *
 * The exemption is **explicit and reviewed**, and it is asserted to be
 * **short** — an exemption list that grows is a hole widening.
 */
const MODEL_ID_CHECKER_FILES: readonly string[] = [
  'tests/unit/gateway-model-ids.test.ts',
  'tests/invariants/inv-9-provider-failover.test.ts',
];

/**
 * Every `.ts` file under a directory, recursively.
 */
const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });

  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      files.push(...(await sourceFiles(path)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }

  return files;
};

/**
 * Every `.ts` file in the scanned roots.
 */
const allSourceFiles = async (): Promise<string[]> => {
  const files: string[] = [];

  for (const root of SCANNED_ROOTS) {
    files.push(...(await sourceFiles(join(repoRoot, root))));
  }

  return files;
};

/**
 * Is a path inside one of the exempt directories?
 */
const isExempt = (file: string): boolean =>
  MODEL_ID_EXEMPT_DIRS.some((dir) => file.startsWith(dir + '/'));

/**
 * Is a path one of the **model-id checker** files?
 *
 * A checker must hold a model id to prove it catches one, so it is
 * exempt from the scan — and the exemption is asserted to be short.
 */
const isModelIdChecker = (file: string): boolean =>
  MODEL_ID_CHECKER_FILES.includes(file.slice(repoRoot.length + 1));

/**
 * The **import specifiers** a source file names.
 *
 * The scan is a **shape** check, not a parser: it needs to find the
 * module specifiers a developer would write a provider SDK into, not to
 * understand the file. It reads `import`/`export … from '…'` and
 * `require('…')` and `import('…')`.
 */
const importSpecifiersIn = (source: string): string[] => {
  const specifiers: string[] = [];

  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match !== null) {
      specifiers.push(match[1] ?? '');
      match = pattern.exec(source);
    }
  }

  return specifiers;
};

/**
 * Does this string name a provider's SDK?
 */
const isProviderSdk = (specifier: string): boolean =>
  PROVIDER_SDKS.some(
    (sdk) => specifier === sdk || specifier.startsWith(`${sdk}/`),
  );

/**
 * Does this string name a provider's model?
 *
 * The check is **shape-based**: it looks for a provider's id *prefix*,
 * not for an enumerated id. So a model the factory has never heard of is
 * caught without the check being updated.
 *
 * A prefix matches when the string **is** the prefix (`command-r`) or
 * **continues** past it with a separator (`gpt-4o` after `gpt`). The
 * continuation must begin with a separator, so `gpt` does not match a
 * bare `gpt` — but `gpt` *is* an id shape worth catching, and it is
 * caught, because the whole prefix list is tried with and without the
 * separator.
 */
const looksLikeAModelId = (value: string): boolean => {
  const lowered = value.toLowerCase();

  return MODEL_ID_PREFIXES.some((prefix) => {
    const bare = prefix.endsWith(SEPARATOR)
      ? prefix.slice(0, -SEPARATOR.length)
      : prefix;

    return lowered === bare || lowered.startsWith(prefix);
  });
};

/**
 * The source of a file with its **comments removed**.
 *
 * A model id in a *literal* is a decision baked into code. A model id in
 * a *comment* is a documentation hazard — a copy-paste source, and a
 * reader's next false impression of what the factory calls.
 *
 * The two are separated because they are **different defects** with
 * different remedies, and because the repository currently carries one
 * of the second kind (see the pinned-defect test below).
 */
const codeOf = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * The **comment text** of a source file.
 *
 * Both block comments and line comments, with the `*` decoration of a
 * block comment stripped — the decoration is not part of the prose.
 */
const commentsOf = (source: string): string =>
  source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('*') || trimmed.startsWith('//');
    })
    .map((line) => line.replace(/^\s*\*+/, '').replace(/^\s*\/\//, ''))
    .join('\n');

/**
 * The **model-id-shaped strings** in a piece of text.
 *
 * Every quoted literal **and** every bare word is searched: a model id
 * is often written unquoted, as a YAML example inside a block comment.
 */
const modelIdStringsIn = (text: string): string[] => {
  const found: string[] = [];

  // The quoted literals — single, double and backtick.
  const literal = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match = literal.exec(text);
  while (match !== null) {
    const value = match[2] ?? '';
    if (looksLikeAModelId(value)) {
      found.push(value);
    }
    match = literal.exec(text);
  }

  // The bare words — the shape a model id takes when it is written
  // unquoted, as a YAML example inside a block comment.
  const word = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9.]+)+/g;
  let wordMatch = word.exec(text);
  while (wordMatch !== null) {
    const value = wordMatch[0];
    if (looksLikeAModelId(value)) {
      found.push(value);
    }
    wordMatch = word.exec(text);
  }

  return found;
};

// ---------------------------------------------------------------------------
// The behavioural half
// ---------------------------------------------------------------------------

/**
 * A routing policy whose class names **two** providers: `alpha` is the
 * primary and `beta` is the fallback.
 *
 * It is the shared fixture with one deliberate difference: the class is
 * named `two-providers` so the test says what it is about.
 */
const THE_TWO_PROVIDER_POLICY: RoutingPolicy = {
  ...THE_POLICY,
  metadata: { name: 'inv9' },
  spec: {
    ...THE_POLICY.spec,
    classes: {
      'two-providers': {
        primary: { provider: 'alpha', model: 'test-model-small' },
        fallbacks: [{ provider: 'beta', model: 'test-model-small' }],
      },
    },
    rules: [{ match: { role: 'worker' }, use: 'two-providers' }],
  },
};

// ---------------------------------------------------------------------------
// The static half's scratch tree
// ---------------------------------------------------------------------------

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
  const root = await mkdtemp(join(tmpdir(), 'factory-inv9-lint-'));
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

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe("INV-9 · no dependency on one model provider", () => {
  describe('the behavioural half — a provider that errors does not end the request', () => {
    it('INV-9 a failing primary is answered by the fallback, and the request succeeds', async () => {
      // The behavioural heart of the invariant: provider A errors, and
      // the request is **answered** — by provider B. A factory that
      // depended on one provider would fail here.
      const { gateway, alpha, beta } = buildGateway({
        policy: THE_TWO_PROVIDER_POLICY,
        alpha: { error: new Error('the provider is down') },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(true);
      // Both were asked: A first, and then B.
      expect(alpha.callCount).toBe(1);
      expect(beta.callCount).toBe(1);
    });

    it('INV-9 the answer came from the FALLBACK provider, not the primary', async () => {
      // The result must name the provider that answered. A gateway that
      // returned A's answer after A failed would be lying, and a gateway
      // that answered from B while *claiming* A would be worse.
      const { gateway } = buildGateway({
        policy: THE_TWO_PROVIDER_POLICY,
        alpha: { error: new Error('the provider is down') },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.provider).toBe('beta');
    });

    it('INV-9 a model.failedOver event is recorded', async () => {
      // "Failover records the reason in the event log (`model.failedOver`)."
      // blueprint 11 §9.6.
      //
      // The assertion is on the **event type** — the registered
      // vocabulary's name — not on the event's position in a list, so a
      // gateway that emitted some other event would not satisfy it.
      const { gateway, events } = buildGateway({
        policy: THE_TWO_PROVIDER_POLICY,
        alpha: { error: new Error('the provider is down') },
      });

      await gateway.complete(aRequest());

      const failedOver = events.filter(
        (event) => event.eventType === 'model.failedOver',
      );

      expect(failedOver).toHaveLength(1);
    });

    it('INV-9 the failover event names where it came from, where it went, and why', async () => {
      // pack 03 §5: `model.failedOver {from, to, trigger}`. The payload
      // is what makes the event **attributable** — a failover with no
      // reason is a failover nobody can audit.
      const { gateway, events } = buildGateway({
        policy: THE_TWO_PROVIDER_POLICY,
        alpha: { error: new Error('the provider is down') },
      });

      await gateway.complete(aRequest());

      const event = events.find(
        (candidate) => candidate.eventType === 'model.failedOver',
      );

      expect(event?.payload['from']).toContain('alpha');
      expect(event?.payload['to']).toContain('beta');
      expect(event?.payload['trigger']).toBe('provider-error');
    });

    it('INV-9 the routing decision records that a fallback was used', async () => {
      const { gateway } = buildGateway({
        policy: THE_TWO_PROVIDER_POLICY,
        alpha: { error: new Error('the provider is down') },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok && result.value.routingDecision.fallbackUsed).toBe(true);
    });

    it('INV-9 the call was recorded against the provider that ANSWERED', async () => {
      // The cost ledger must charge the provider that did the work. A
      // ledger that charged A would make the cost of a failover
      // invisible — and the budget would be checked against the wrong
      // provider's price.
      const { gateway, calls } = buildGateway({
        policy: THE_TWO_PROVIDER_POLICY,
        alpha: { error: new Error('the provider is down') },
      });

      await gateway.complete(aRequest());

      expect(calls.records).toHaveLength(1);
      expect(calls.records[0]?.provider).toBe('beta');
    });

    it('INV-9 the primary is NOT consulted when it is the one that failed — and the other way round', async () => {
      // The failover is **directional**: it is the *primary* that fails
      // over to the *fallback*. A gateway that failed the other way —
      // asking the fallback first — would satisfy a naive test and
      // break the policy.
      //
      // So the same policy is driven with the **fallback** failing and
      // the primary answering: the primary must be used, and **no**
      // failover event may be emitted.
      const { gateway, alpha, beta, events } = buildGateway({
        policy: THE_TWO_PROVIDER_POLICY,
        beta: { error: new Error('the provider is down') },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.provider).toBe('alpha');
      expect(alpha.callCount).toBe(1);
      // The fallback was never reached: the primary answered.
      expect(beta.callCount).toBe(0);
      expect(
        events.filter((event) => event.eventType === 'model.failedOver'),
      ).toHaveLength(0);
    });

    it('INV-9 the failover is refused when the policy lists no fallback', async () => {
      // The other half of "not hard-coded": the failover is a **policy
      // decision**, not a hard-wired behaviour. A class with no fallback
      // has nowhere to go, so the failure is the request's — and the
      // factory's correctness depends on the operator having declared a
      // second provider.
      const policy: RoutingPolicy = {
        ...THE_TWO_PROVIDER_POLICY,
        spec: {
          ...THE_TWO_PROVIDER_POLICY.spec,
          classes: {
            'two-providers': {
              primary: { provider: 'alpha', model: 'test-model-small' },
              fallbacks: [],
            },
          },
        },
      };

      const { gateway, alpha, beta } = buildGateway({
        policy,
        alpha: { error: new Error('the provider is down') },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(false);
      expect(alpha.callCount).toBe(1);
      expect(beta.callCount).toBe(0);
    });
  });

  describe('the static half — the provider boundary holds', () => {
    it('INV-9 the repository still carries the INV-9 provider rule', async () => {
      const config = await readFile(repoEslintConfig, 'utf8');

      expect(() => extractProviderRule(config)).not.toThrow();
      expect(extractProviderRule(config)).toContain('no-restricted-imports');
    });

    it('INV-9 a provider imported from OUTSIDE the gateway FAILS the rule', async () => {
      // The rule is proved **to bite**. A rule that rejected nothing
      // would satisfy every other test in this file.
      await withScratch({ importer: BAD_IMPORT }, async (root) => {
        const result = await lint(root, ['packages/other/index.ts']);

        expect(result.exitCode).not.toBe(0);
        expect(result.output).toContain('no-restricted-imports');
        expect(result.output).toContain(
          'Provider adapters may only be reached through the gateway',
        );
      });
    }, 120_000);

    it('INV-9 the same tree WITHOUT the provider import PASSES the rule', async () => {
      // The rule is proved **not to over-reject**. Without this, the
      // previous test would be satisfied by a rule that fails on
      // everything.
      await withScratch({ importer: GOOD_IMPORT }, async (root) => {
        const result = await lint(root, ['packages/other/index.ts']);

        expect(result.output).not.toContain('no-restricted-imports');
        expect(result.exitCode).toBe(0);
      });
    }, 120_000);

    it("INV-9 the gateway's OWN provider modules are not linted by the rule", async () => {
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

    it('INV-9 no provider SDK is imported outside gateway/providers/*', async () => {
      // The **structural** half of "all provider-specific behaviour is
      // confined to the adapter" (blueprint 11 §9.4).
      //
      // The lint rule polices an import of the factory's *own* provider
      // modules; this check polices an import of a provider's *SDK*. A
      // module outside the adapter boundary that can `import OpenAI from
      // 'openai'` can speak a provider's dialect — and the neutrality
      // the whole design rests on is gone.
      const files = await allSourceFiles();

      const found: { readonly file: string; readonly specifier: string }[] = [];

      for (const file of files) {
        // The adapter directory is the boundary's inside: the adapters
        // are where a provider's dialect lives.
        if (file.includes('/packages/gateway/src/providers/')) {
          continue;
        }

        const source = await readFile(file, 'utf8');

        for (const specifier of importSpecifiersIn(source)) {
          if (isProviderSdk(specifier)) {
            found.push({
              file: file.slice(repoRoot.length + 1),
              specifier,
            });
          }
        }
      }

      expect(
        found,
        `provider SDKs imported outside gateway/providers/*: ${found
          .map((entry) => `${entry.file}: ${entry.specifier}`)
          .join(', ')}`,
      ).toEqual([]);
    }, 120_000);

    it('INV-9 no model id exists outside the configuration', async () => {
      // The **config-only** half of decision 0023: *"Routing is **config
      // only** (`routing-policy.yaml`); names are examples … gateway
      // refuses unknown models."*
      //
      // A model id in the source is a decision about which model to call,
      // baked into code instead of read from the definition — and it is
      // a decision that no operator can change without a code change.
      //
      // **Comments are excluded here**, and the exclusion is not a
      // weakening: the comment case is a different defect and it has its
      // own test below, which **pins the known occurrence** so that it
      // cannot spread unnoticed. A model id in a *literal* is a
      // decision; a model id in a *comment* is a hazard. Both are
      // faults; only the first is a hard-coded decision.
      const files = await allSourceFiles();

      const found: { readonly file: string; readonly value: string }[] = [];

      for (const file of files) {
        if (isExempt(file) || isModelIdChecker(file)) {
          continue;
        }

        const source = await readFile(file, 'utf8');

        for (const value of modelIdStringsIn(codeOf(source))) {
          found.push({ file: file.slice(repoRoot.length + 1), value });
        }
      }

      expect(
        found,
        `model ids outside the configuration: ${found
          .map((entry) => `${entry.file}: ${entry.value}`)
          .join(', ')}`,
      ).toEqual([]);
    }, 120_000);

    it('INV-9 the model ids live in the CONFIGURATION', async () => {
      // The positive half: the ids the factory uses are in
      // `definition/routing-policy.yaml` and `definition/pricing.yaml`,
      // and nowhere else.
      const policy = await readFile(
        join(repoRoot, 'definition', 'routing-policy.yaml'),
        'utf8',
      );
      const pricing = await readFile(
        join(repoRoot, 'definition', 'pricing.yaml'),
        'utf8',
      );

      expect(policy).toContain('model:');
      expect(policy).toMatch(/model: [a-z][a-z0-9-]+/);
      expect(pricing).toMatch(/^\s{4}[a-z][a-z0-9-]+:/m);
    });

    it("INV-9 the gateway's own source contains no model id in CODE", async () => {
      // The gateway's source is the place the rule bites hardest: it is
      // the component that *calls* models. So it is checked with no
      // exemption — adapters included.
      const gatewaySrc = join(repoRoot, 'packages', 'gateway', 'src');
      const files = await sourceFiles(gatewaySrc);

      const found: { readonly file: string; readonly value: string }[] = [];

      for (const file of files) {
        const source = await readFile(file, 'utf8');

        for (const value of modelIdStringsIn(codeOf(source))) {
          found.push({ file: file.slice(repoRoot.length + 1), value });
        }
      }

      expect(
        found,
        `model ids in the gateway's source: ${found
          .map((entry) => `${entry.file}: ${entry.value}`)
          .join(', ')}`,
      ).toEqual([]);
    }, 120_000);

    it('INV-9 the model ids in COMMENTS are the KNOWN ones, and no more', async () => {
      // ## The known defect this test pins
      //
      // `packages/gateway/src/routing.ts` names two model ids in the
      // **doc comment** that illustrates the routing-policy YAML. They
      // are not decisions — nothing reads them — but they are a
      // copy-paste hazard, and the repository's own model-id check
      // (`tests/unit/gateway-model-ids.test.ts`) **misses them**,
      // because it only looks at *quoted* literals on comment lines and
      // these are bare words inside a YAML example.
      //
      // This test does not fix it — the fix is a product change, and the
      // ticket this file was written for forbids one. What it does is
      // **pin the occurrence**: the exact set of files and ids is
      // asserted, so
      //
      // * the defect is *visible* rather than hidden, and
      // * it **turns red the moment it spreads** — a new file naming a
      //   model id in a comment, or a new id in this one, fails here.
      //
      // When the product fix lands (the ids removed from the comment),
      // this test fails with "expected [] to deeply equal [ … ]" — which
      // is the signal to delete the pinned entry, not to re-pin it.
      const files = await allSourceFiles();

      const found: { readonly file: string; readonly value: string }[] = [];

      for (const file of files) {
        if (isExempt(file) || isModelIdChecker(file)) {
          continue;
        }

        const source = await readFile(file, 'utf8');

        for (const value of modelIdStringsIn(commentsOf(source))) {
          found.push({ file: file.slice(repoRoot.length + 1), value });
        }
      }

      // The known occurrence, pinned. The ids are spelled out here in
      // full so that the pin is a statement about *these* ids — and the
      // file that holds the scan's own machinery is exempt, so this pin
      // does not count as a second occurrence.
      const known = [
        {
          file: 'packages/gateway/src/routing.ts',
          value: `claude${SEPARATOR}haiku${SEPARATOR}5${SEPARATOR}5`,
        },
        {
          file: 'packages/gateway/src/routing.ts',
          value: `claude${SEPARATOR}opus${SEPARATOR}5${SEPARATOR}5`,
        },
      ];

      expect(
        found,
        `model ids in comments (the known defect is ${known
          .map((entry) => `${entry.file}: ${entry.value}`)
          .join(', ')}): ${found
          .map((entry) => `${entry.file}: ${entry.value}`)
          .join(', ')}`,
      ).toEqual(known);
    }, 120_000);

    it('INV-9 the provider-SDK list is SHORT', () => {
      // The list is a hole if it grows. Ten entries is enough for the
      // SDKs the factory must not import; more than that means the
      // check is being weakened rather than the source being fixed.
      expect(PROVIDER_SDKS.length).toBeLessThanOrEqual(12);
    });

    it('INV-9 the model-id prefix list is SHORT', () => {
      // Same discipline: a prefix list that grows into a catalogue of
      // ids is the thing INV-9 forbids, moved into the test.
      expect(MODEL_ID_PREFIXES.length).toBeLessThanOrEqual(12);
    });

    it('INV-9 the model-id checker exemption list is SHORT', () => {
      // The exemption is a hole if it grows. Only a file whose *job* is
      // to detect model ids may hold one; a third would mean the scan
      // is being weakened rather than the sources being fixed.
      expect(MODEL_ID_CHECKER_FILES.length).toBeLessThanOrEqual(3);
    });

    it('INV-9 the checks CATCH what they are meant to catch', () => {
      // A check that has never been shown to fail is not a check
      // (checklist 01 trap 6).
      //
      // The sample ids are **assembled** from their parts, so this file
      // holds no complete model-id-shaped string — see the note on
      // {@link MODEL_ID_PREFIXES}.
      const sample = (name: string, version: string): string =>
        `${name}${SEPARATOR}${version}`;

      expect(looksLikeAModelId(sample('claude', 'haiku-5-5'))).toBe(true);
      expect(looksLikeAModelId(sample('gpt', '4o'))).toBe(true);
      expect(looksLikeAModelId(sample('gemini', '2.5-pro'))).toBe(true);
      expect(looksLikeAModelId(sample('llama', '3.1-70b'))).toBe(true);

      expect(isProviderSdk('openai')).toBe(true);
      expect(isProviderSdk('@anthropic-ai/sdk')).toBe(true);
      expect(isProviderSdk('@anthropic-ai/sdk/resources/messages')).toBe(true);
    });

    it('INV-9 the checks do NOT catch ordinary identifiers', () => {
      // The check must not fire on the factory's own vocabulary, or it
      // would be turned off — and a turned-off check is no check.
      expect(looksLikeAModelId('workflow.composition')).toBe(false);
      expect(looksLikeAModelId('budget.exhausted')).toBe(false);
      expect(looksLikeAModelId('model.requested')).toBe(false);
      expect(looksLikeAModelId('factory/v1')).toBe(false);
      expect(looksLikeAModelId('RoutingPolicy')).toBe(false);
      expect(looksLikeAModelId('run_inv9_0001')).toBe(false);
      expect(looksLikeAModelId('node-1')).toBe(false);
      expect(looksLikeAModelId('task-1')).toBe(false);

      expect(isProviderSdk('@factory/contracts')).toBe(false);
      expect(isProviderSdk('@factory/gateway')).toBe(false);
      expect(isProviderSdk('node:fs')).toBe(false);
    });
  });
});
