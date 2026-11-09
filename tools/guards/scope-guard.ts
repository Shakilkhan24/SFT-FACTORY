/**
 * `tools/scope-guard` — the CI check that a PR touches only what it declared.
 *
 * Pack 05, T-0.03: "reads the `Allowed-paths:` globs from the PR body and
 * fails if the diff touches anything else."
 *
 * The rule is deliberately simple and deliberately strict:
 *
 *   - The PR body MUST declare `Allowed-paths:`. A missing declaration is a
 *     failure, not a pass. An absent scope is an unbounded scope.
 *   - Every changed path MUST match at least one declared glob.
 *   - The declared globs themselves are checked: a glob that matches nothing
 *     is reported, because a typo'd glob silently narrows the scope to
 *     "nothing is allowed" and then everything is out of scope.
 *
 * Fail-closed (HR-8): if the diff cannot be determined, the guard fails. It
 * never passes because it could not check.
 */

import { globToRegExp } from '../lib/glob.ts';

export interface AllowedPaths {
  /** The declared globs. */
  readonly globs: string[];
  /** Whether an `Allowed-paths:` header was found at all. */
  readonly found: boolean;
  /** Declarations that could not be used as written. */
  readonly malformed: string[];
}

export interface ScopeVerdict {
  /** Whether the PR may pass. */
  readonly ok: boolean;
  /** The reasons it may not. */
  readonly violations: string[];
  /** The globs that were declared. */
  readonly globs: string[];
  /** The globs that matched no changed path — a possible typo. */
  readonly unmatched: string[];
}

export interface ScopeInput {
  /** The PR body. */
  readonly body: string;
  /** The paths the PR changed. */
  readonly changedPaths: readonly string[];
}

/**
 * Strip the markdown code fence from a declared path.
 *
 * The pack's own examples write the globs in backticks — `` `packages/core/**` `` — and
 * so does the PR template. A backtick is markdown, not part of the path: leaving it in
 * makes the glob match nothing, which silently turns the guard into "everything is out of
 * scope". The backticks are therefore removed, and a path that is *only* backticks is
 * rejected rather than becoming an empty glob.
 */
const stripCodeFence = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

/**
 * Parse the `Allowed-paths:` declaration out of a PR body.
 *
 * Two header forms are accepted, because both appear in practice:
 *
 *   `Allowed-paths:`            — the pack's form; the globs follow on the
 *                                 next lines, one per line, optionally as a
 *                                 markdown list.
 *   `## Allowed-paths`          — a markdown section heading.
 *
 * A path may also be given inline after the colon. The header may appear
 * once; a second declaration is an error, because two scopes are not a
 * scope — it is an ambiguity about which one applies.
 */
export const parseAllowedPaths = (body: string): AllowedPaths => {
  const lines = body.split('\n');
  const globs: string[] = [];
  const malformed: string[] = [];
  let found = false;
  let inSection = false;
  let headers = 0;

  for (const line of lines) {
    const header = /^(?:#{1,6}\s*)?allowed-paths\s*:?\s*(.*)$/i.exec(line.trim());
    if (header) {
      headers += 1;
      if (headers > 1) {
        malformed.push(
          'the `Allowed-paths:` header appears more than once — two scopes are not a scope',
        );
        continue;
      }
      found = true;
      inSection = true;
      const inline = stripCodeFence(header[1] ?? '');
      if (inline) {
        globs.push(inline);
      }
      continue;
    }

    if (!inSection) {
      continue;
    }

    // The section ends at the next non-list, non-blank line.
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    if (!trimmed.startsWith('-') && !trimmed.startsWith('*') && !trimmed.startsWith('/')) {
      inSection = false;
      continue;
    }

    const value = stripCodeFence(trimmed.replace(/^-\s*/, '').trim());
    if (value === '') {
      malformed.push('an allowed-path entry is empty');
      continue;
    }
    if (value.endsWith('/')) {
      malformed.push(`${value} — a trailing "/" is ambiguous; write it as "${value}**"`);
      continue;
    }
    globs.push(value);
  }

  return { globs, found, malformed };
};

/**
 * Decide whether `path` is inside `globs`.
 */
export const isPathAllowed = (path: string, globs: readonly string[]): boolean =>
  globs.some((glob) => globToRegExp(glob).test(path));

/**
 * The guard's verdict.
 */
export const checkScope = ({ body, changedPaths }: ScopeInput): ScopeVerdict => {
  const { globs, found, malformed } = parseAllowedPaths(body);
  const violations: string[] = [];

  if (!found) {
    violations.push(
      'The PR body has no `Allowed-paths:` declaration. A missing scope is an unbounded scope — declare the paths this PR is allowed to touch.',
    );
    return { ok: false, violations, globs, unmatched: [] };
  }

  if (globs.length === 0) {
    violations.push(
      'The `Allowed-paths:` declaration is empty. Declare at least one path this PR is allowed to touch.',
    );
    return { ok: false, violations, globs, unmatched: [] };
  }

  for (const problem of malformed) {
    violations.push(`Malformed allowed-path ${problem}`);
  }

  const outside = changedPaths.filter((path) => !isPathAllowed(path, globs)).sort();
  for (const path of outside) {
    violations.push(`Path outside Allowed-paths: ${path}`);
  }

  // A glob that matches nothing is a scope typo. Report it, but do not fail
  // on it alone — a legitimately empty scope (e.g. a docs-only PR that
  // changed nothing) is not a violation.
  const unmatched = globs.filter(
    (glob) => !changedPaths.some((path) => globToRegExp(glob).test(path)),
  );

  return { ok: violations.length === 0, violations, globs, unmatched };
};

/** Render a verdict as the lines a CI job prints. */
export const formatVerdict = (verdict: ScopeVerdict): string => {
  const lines: string[] = [];
  if (verdict.ok) {
    lines.push('scope-guard: OK — every changed path is inside Allowed-paths.');
    if (verdict.unmatched.length > 0) {
      lines.push(
        `scope-guard: note — no changed path matched ${verdict.unmatched.join(', ')}. Check the glob for a typo.`,
      );
    }
    return lines.join('\n');
  }
  lines.push('scope-guard: FAIL');
  for (const violation of verdict.violations) {
    lines.push(`  - ${violation}`);
  }
  return lines.join('\n');
};
