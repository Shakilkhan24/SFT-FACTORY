/**
 * T-0.03 oracle — the guards actually reject.
 *
 * Pack 05, T-0.03: "Oracle: oracle-guard rejects a synthetic PR editing an
 * oracle file and accepts a human-authored one; scope-guard rejects a PR
 * touching a path outside `Allowed-paths`; context-bundle fails on an
 * oversize bundle."
 *
 * Checklist 01 trap 6: "Writing the guards but not testing them negatively. A
 * guard that has never rejected anything is not a guard." Each rule below has
 * a test that proves it FAILS on the bad case AND PASSES on the good case —
 * a test that only proves the happy path proves nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  checkOracle,
  matchesAny,
  PROTECTED_GLOBS,
} from '../../tools/guards/oracle-guard.ts';
import {
  checkScope,
  formatVerdict as formatScopeVerdict,
  parseAllowedPaths,
} from '../../tools/guards/scope-guard.ts';
import { globToRegExp } from '../../tools/lib/glob.ts';

const PR_BODY = [
  '## What this changes',
  'Adds the thing.',
  '',
  '## Allowed-paths',
  '- packages/core/src/**',
  '- tests/unit/**',
].join('\n');

describe('T-0.03 — scope-guard', () => {
  it('A0.47 — ACCEPTS a PR whose globs are written in backticks', () => {
    // The pack's own examples and the PR template both write the globs in backticks.
    // A backtick is markdown, not part of the path — if it were kept, the glob would
    // match nothing and every path would be "outside Allowed-paths".
    const body = [
      '## Allowed-paths:',
      '',
      '- `packages/core/**`',
      '- `tests/unit/**`',
    ].join('\n');

    const verdict = checkScope({
      body,
      changedPaths: ['packages/core/src/hash.ts', 'tests/unit/guards.test.ts'],
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.violations).toEqual([]);
  });

  it('A0.48 — REJECTS an out-of-scope path when the glob is written in backticks', () => {
    const body = ['## Allowed-paths:', '', '- `packages/core/**`'].join('\n');

    const verdict = checkScope({
      body,
      changedPaths: ['packages/core/src/hash.ts', 'packages/contracts/src/index.ts'],
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.violations.join('\n')).toContain('packages/contracts/src/index.ts');
  });

  it('A0.10 — ACCEPTS a PR whose diff is entirely inside Allowed-paths', () => {
    const verdict = checkScope({
      body: PR_BODY,
      changedPaths: ['packages/core/src/hash.ts', 'tests/unit/core.test.ts'],
    });

    expect(verdict.ok).toBe(true);
    expect(formatScopeVerdict(verdict)).toContain('OK');
  });

  it('A0.11 — REJECTS a PR touching a path outside Allowed-paths', () => {
    const verdict = checkScope({
      body: PR_BODY,
      changedPaths: ['packages/core/src/hash.ts', 'packages/credentials/src/broker.ts'],
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.violations.join(' ')).toContain(
      'Path outside Allowed-paths: packages/credentials/src/broker.ts',
    );
  });

  it('A0.12 — REJECTS a PR with no Allowed-paths declaration at all', () => {
    const verdict = checkScope({
      body: '## What this changes\nAdds the thing.',
      changedPaths: ['packages/core/src/hash.ts'],
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.violations.join(' ')).toContain('no `Allowed-paths:` declaration');
  });

  it('A0.13 — REJECTS a PR with an EMPTY Allowed-paths declaration', () => {
    const verdict = checkScope({
      body: '## What this changes\n\n## Allowed-paths:\n',
      changedPaths: ['packages/core/src/hash.ts'],
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.violations.join(' ')).toContain('declaration is empty');
  });

  it('A0.14 — REJECTS a glob with a trailing slash, which is ambiguous', () => {
    const { malformed } = parseAllowedPaths('Allowed-paths:\n- packages/core/\n');
    expect(malformed).toHaveLength(1);
    expect(malformed[0]).toContain('trailing "/"');
  });

  it('A0.15 — reports a glob that matched nothing, as a possible typo', () => {
    const verdict = checkScope({
      body: 'Allowed-paths:\n- packages/core/src/**\n- packagez/typo/**\n',
      changedPaths: ['packages/core/src/hash.ts'],
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.unmatched).toEqual(['packagez/typo/**']);
    expect(formatScopeVerdict(verdict)).toContain('typo');
  });
});

describe('T-0.03 — oracle-guard', () => {
  it('A0.16 — ACCEPTS a PR that touches no oracle path', () => {
    const verdict = checkOracle({
      changedPaths: ['packages/core/src/hash.ts'],
      allCommitsHuman: false,
      hasOracleApproved: false,
      commitsAvailable: true,
    });

    expect(verdict.ok).toBe(true);
  });

  it('A0.17 — REJECTS a synthetic PR that edits an oracle file', () => {
    const verdict = checkOracle({
      changedPaths: ['packages/core/test/oracle/hash.spec.ts'],
      allCommitsHuman: false,
      hasOracleApproved: false,
      commitsAvailable: true,
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.violations.join(' ')).toContain('oracle path');
    expect(verdict.violations.join(' ')).toContain('ADR-0005');
  });

  it('A0.18 — REJECTS a synthetic PR that edits tests/acceptance', () => {
    const verdict = checkOracle({
      changedPaths: ['tests/acceptance/a0.1.spec.ts'],
      allCommitsHuman: false,
      hasOracleApproved: false,
      commitsAvailable: true,
    });

    expect(verdict.ok).toBe(false);
  });

  it('A0.19 — ACCEPTS the same oracle edit when the commits are human-authored', () => {
    const verdict = checkOracle({
      changedPaths: ['packages/core/test/oracle/hash.spec.ts'],
      allCommitsHuman: true,
      hasOracleApproved: false,
      commitsAvailable: true,
    });

    expect(verdict.ok).toBe(true);
  });

  it('A0.20 — ACCEPTS the same oracle edit when the PR is labelled oracle-approved', () => {
    const verdict = checkOracle({
      changedPaths: ['packages/core/test/oracle/hash.spec.ts'],
      allCommitsHuman: false,
      hasOracleApproved: true,
      commitsAvailable: true,
    });

    expect(verdict.ok).toBe(true);
  });

  it('A0.21 — FAILS CLOSED when the commit list cannot be read', () => {
    const verdict = checkOracle({
      changedPaths: ['packages/core/test/oracle/hash.spec.ts'],
      allCommitsHuman: false,
      hasOracleApproved: false,
      commitsAvailable: false,
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.violations.join(' ')).toContain('Failing closed');
  });

  it('A0.22 — WARNS about a sensitive non-oracle path without human authorship', () => {
    const verdict = checkOracle({
      changedPaths: ['packages/contracts/src/index.ts'],
      allCommitsHuman: false,
      hasOracleApproved: false,
      commitsAvailable: true,
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.join(' ')).toContain('sensitive path');
  });

  it('A0.23 — the protected glob set actually covers the documented paths', () => {
    expect(matchesAny('packages/core/test/oracle/hash.spec.ts', PROTECTED_GLOBS)).toBe(true);
    expect(matchesAny('tests/acceptance/a0.1.spec.ts', PROTECTED_GLOBS)).toBe(true);
    expect(matchesAny('tests/invariants/inv-1.spec.ts', PROTECTED_GLOBS)).toBe(false);
  });
});

describe('T-0.03 — the glob matcher', () => {
  it('A0.24 — `**` matches across directories, `*` does not', () => {
    expect(globToRegExp('packages/core/**').test('packages/core/src/deep/hash.ts')).toBe(true);
    expect(globToRegExp('packages/core/*').test('packages/core/src/hash.ts')).toBe(false);
    expect(globToRegExp('packages/core/*').test('packages/core/hash.ts')).toBe(true);
  });

  it('A0.25 — `**/` also matches zero directories', () => {
    expect(globToRegExp('**/test/oracle/**').test('test/oracle/a.ts')).toBe(true);
    expect(globToRegExp('**/test/oracle/**').test('packages/core/test/oracle/a.ts')).toBe(true);
  });

  it('A0.26 — a bare filename glob matches at any depth', () => {
    expect(globToRegExp('CODEOWNERS').test('CODEOWNERS')).toBe(true);
    expect(globToRegExp('CODEOWNERS').test('docs/CODEOWNERS')).toBe(true);
  });

  it('A0.27 — `{a,b}` alternatives work', () => {
    expect(globToRegExp('packages/{core,policy}/**').test('packages/policy/src/x.ts')).toBe(true);
    expect(globToRegExp('packages/{core,policy}/**').test('packages/gateway/src/x.ts')).toBe(false);
  });
});
