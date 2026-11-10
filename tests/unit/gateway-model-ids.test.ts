/**
 * T-1.10 — INV-9's second half: no model id in the gateway's source.
 *
 * INV-9: *"lint proves no provider SDK/type imported outside
 * `gateway/providers/*` and **no model-id string outside config**."*
 *
 * ## Why this needs a **test** and not a lint rule
 *
 * The first half of INV-9 is a lint rule, because it polices an
 * **import** — a thing ESLint can see. The second half polices a
 * **string literal**: a model id written into the gateway's source.
 *
 * `no-restricted-imports` cannot see a string. There is no ESLint rule
 * that bans "the word `claude-`" in a file, and writing one would be
 * worse than none: it would need a hard-coded list of model ids in the
 * linter — which is the very thing INV-9 forbids, moved from the source
 * into the tool.
 *
 * So the second half is enforced by a **different** mechanism: the
 * gateway's source is read, and the model-id-shaped strings in it are
 * counted. The check is mechanical, it needs no list of ids, and it
 * fails loudly when the source grows one.
 *
 * ## What counts as a model-id-shaped string
 *
 * A string that **looks like** a provider's model id: it contains a
 * dash and a digit, and it is not a known non-model constant. The
 * corpus's own ids — `claude-haiku-5-5`, `claude-sonnet-5-5` — are the
 * target. The check is deliberately **shape-based** so that a new
 * model's id is caught without the check being updated.
 *
 * The false positives are handled by an explicit, reviewed list of
 * non-model strings — and the list is asserted to be **short**, so a
 * growing allow-list cannot quietly become a hole.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const gatewaySrc = join(repoRoot, 'packages', 'gateway', 'src');

/**
 * The strings in the gateway's source that **look** like a model id but
 * are not one.
 *
 * Each entry is a constant the gateway defines — a header name, a
 * content-block type, a JSON-schema keyword. They are reviewed, and
 * the list is asserted to be short so it cannot become a hole.
 */
const NOT_MODEL_IDS: readonly string[] = [
  // Anthropic's content-block and tool types.
  'tool_use',
  'tool_result',
  'text-block',
  // The JSON-schema keywords the forced tool's schema may use.
  'json-schema',
  'additional-properties',
];

/**
 * Does this string look like a provider's model id?
 *
 * The shape is the corpus's: a name, a dash, a version with a digit.
 * `claude-haiku-5-5` matches; `workflow.composition` and `budget.exhausted`
 * do not — they have no dash-digit pair.
 */
const looksLikeAModelId = (value: string): boolean => {
  if (NOT_MODEL_IDS.includes(value)) {
    return false;
  }

  // A model id is lowercase-ish and contains a dash followed by a
  // digit: `something-5`, `something-5-5`, `gpt-4o`.
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d[a-z0-9-]*$/.test(value);
};

/**
 * The string literals in a source file.
 *
 * Single-quoted, double-quoted and backtick strings, with the obvious
 * escapes. This is a **shape** check, not a parser: it needs to find
 * the literals a developer would write a model id in, not to understand
 * the file.
 */
const literalsIn = (source: string): string[] => {
  const literals: string[] = [];

  const pattern = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match = pattern.exec(source);

  while (match !== null) {
    literals.push(match[2] ?? '');
    match = pattern.exec(source);
  }

  return literals;
};

/**
 * Every `.ts` file in a directory, recursively.
 */
const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });

  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }

  return files;
};

describe('T-1.10 — INV-9’s second half: no model id in the source', () => {
  it('the gateway’s source contains NO model-id-shaped string', async () => {
    const files = await sourceFiles(gatewaySrc);

    const found: { readonly file: string; readonly literal: string }[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      for (const literal of literalsIn(source)) {
        if (looksLikeAModelId(literal)) {
          found.push({ file: file.slice(repoRoot.length + 1), literal });
        }
      }
    }

    expect(
      found,
      `model-id-shaped strings in the gateway's source: ${found
        .map((f) => `${f.file}: ${f.literal}`)
        .join(', ')}`,
    ).toEqual([]);
  });

  it('the gateway’s source contains no model id in a COMMENT either', async () => {
    // A model id in a comment is still a model id in the source: it is
    // a copy-paste hazard, and the next developer would read it as
    // the id the gateway uses.
    const files = await sourceFiles(gatewaySrc);

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const comments = source
        .split('\n')
        .filter((line) => line.trim().startsWith('*') || line.trim().startsWith('//'));

      for (const comment of comments) {
        for (const literal of literalsIn(comment)) {
          expect(
            looksLikeAModelId(literal),
            `the comment in ${file.slice(repoRoot.length + 1)} names "${literal}"`,
          ).toBe(false);
        }
      }
    }
  });

  it('the allow-list of non-model strings is SHORT', () => {
    // The allow-list is a hole if it grows. Ten entries is enough for
    // the constants the gateway defines; more than that means the
    // check is being weakened rather than the source being fixed.
    expect(NOT_MODEL_IDS.length).toBeLessThanOrEqual(10);
  });

  it('the check CATCHES a model id', () => {
    // The check itself must be shown to work — a check that has never
    // been shown to fail is not a check (checklist 01 trap 6).
    expect(looksLikeAModelId('claude-haiku-5-5')).toBe(true);
    expect(looksLikeAModelId('claude-sonnet-5-5')).toBe(true);
    expect(looksLikeAModelId('gpt-4o')).toBe(true);
  });

  it('the check does NOT catch ordinary identifiers', () => {
    expect(looksLikeAModelId('workflow.composition')).toBe(false);
    expect(looksLikeAModelId('budget.exhausted')).toBe(false);
    expect(looksLikeAModelId('model.requested')).toBe(false);
    expect(looksLikeAModelId('structured_output')).toBe(false);
    expect(looksLikeAModelId('factory/v1')).toBe(false);
    expect(looksLikeAModelId('RoutingPolicy')).toBe(false);
  });

  it('the model ids live in the CONFIGURATION', async () => {
    // The positive half: the ids the factory uses are in
    // `definition/routing-policy.yaml`, and nowhere else.
    const policy = await readFile(
      join(repoRoot, 'definition', 'routing-policy.yaml'),
      'utf8',
    );

    expect(policy).toContain('model:');
    expect(policy).toMatch(/model: [a-z][a-z0-9-]+/);
  });
});
