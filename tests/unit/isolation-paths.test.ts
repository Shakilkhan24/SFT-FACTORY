/**
 * The **path-safety helper** — the traversal defence.
 *
 * A snapshot is a `git archive` extracted onto the host, so a tar member's
 * name is data, and a member called `../../etc/cron.d/x` is an escape the
 * moment it is written. These tests pin the rules that stop it.
 */

import { describe, expect, it } from 'vitest';

import {
  checkKey,
  checkSha,
  isSha,
  resolveInside,
  resolveLinkTarget,
} from '../../packages/isolation/src/index.ts';

const ROOT = '/snapshots';

describe('the base SHA validator', () => {
  it('accepts a 40-character lower-case hex commit name', () => {
    const sha = 'a'.repeat(40);
    expect(isSha(sha)).toBe(true);
    expect(checkSha(sha).ok).toBe(true);
  });

  it('accepts a SHA with digits and letters mixed', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(isSha(sha)).toBe(true);
  });

  it('refuses a short SHA', () => {
    // A short SHA is **ambiguous** — two commits can share a prefix — so a
    // snapshot keyed by one would not be keyed by a commit.
    expect(isSha('abc1234')).toBe(false);
    expect(checkSha('abc1234').ok).toBe(false);
  });

  it('refuses a 64-character name', () => {
    expect(isSha('f'.repeat(64))).toBe(false);
  });

  it('refuses an upper-case name', () => {
    // Git emits lower-case. Accepting upper-case too would give two
    // directory names for one commit.
    expect(isSha('A'.repeat(40))).toBe(false);
  });

  it('refuses a ref name', () => {
    expect(isSha('HEAD')).toBe(false);
    expect(isSha('main')).toBe(false);
  });

  it('refuses a path', () => {
    expect(isSha('../../etc/passwd')).toBe(false);
    expect(isSha('a/../../b')).toBe(false);
  });

  it('refuses an empty name', () => {
    expect(isSha('')).toBe(false);
    const result = checkSha('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('empty');
    }
  });

  it('refuses a name with a non-hex character', () => {
    expect(isSha('z'.repeat(40))).toBe(false);
    expect(isSha(`${'a'.repeat(39)}-`)).toBe(false);
  });
});

describe('the key validator', () => {
  it('accepts a SHA', () => {
    expect(checkKey('a'.repeat(40)).ok).toBe(true);
  });

  it('accepts a slug', () => {
    expect(checkKey('feature-add-login').ok).toBe(true);
  });

  it('refuses a key that escapes', () => {
    // A key becomes a **path segment**, so this is the same escape the
    // tar members are checked for, arriving through the request.
    expect(checkKey('../../etc').ok).toBe(false);
    expect(checkKey('..').ok).toBe(false);
    expect(checkKey('.').ok).toBe(false);
  });

  it('refuses a key with a slash', () => {
    expect(checkKey('a/b').ok).toBe(false);
  });

  it('refuses a key with a space', () => {
    expect(checkKey('a b').ok).toBe(false);
  });

  it('refuses an empty key', () => {
    expect(checkKey('').ok).toBe(false);
  });
});

describe('the path resolver', () => {
  it('resolves a plain relative path', () => {
    const result = resolveInside(ROOT, 'src/index.ts');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe('/snapshots/src/index.ts');
    }
  });

  it('resolves a nested path', () => {
    const result = resolveInside(ROOT, 'a/b/c.txt');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe('/snapshots/a/b/c.txt');
    }
  });

  it('refuses a path that climbs out with `..`', () => {
    const result = resolveInside(ROOT, '../escape');
    expect(result.ok).toBe(false);
  });

  it('refuses a path that climbs out from a subdirectory', () => {
    // The string contains `..`, but the interesting part is that the
    // escape is **after** a valid directory.
    const result = resolveInside(ROOT, 'a/../../escape');
    expect(result.ok).toBe(false);
  });

  it('refuses a path that climbs out and comes back', () => {
    // `a/../b` does not escape, so it is **allowed** — and
    // `a/../../b` does, so it is not. A naive `includes('..')` check
    // would refuse both.
    expect(resolveInside(ROOT, 'a/../b').ok).toBe(true);
    expect(resolveInside(ROOT, 'a/../../b').ok).toBe(false);
  });

  it('refuses an absolute path', () => {
    const result = resolveInside(ROOT, '/etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('refuses an absolute path for the reason that it is absolute', () => {
    // The refusal must name the reason. Without this, an absolute path
    // refused for an *incidental* reason — the empty leading segment,
    // say — would satisfy the rule above, and the specific check would
    // become unobservable. The mutation harness proved that: every
    // malformed name was refused with one generic message, so the two
    // checks were indistinguishable.
    const result = resolveInside(ROOT, '/etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('absolute');
    }
  });

  it('refuses a path with a `.` segment', () => {
    expect(resolveInside(ROOT, './a').ok).toBe(false);
    expect(resolveInside(ROOT, 'a/./b').ok).toBe(false);
  });

  it('refuses an empty path', () => {
    expect(resolveInside(ROOT, '').ok).toBe(false);
  });

  it('refuses a path with an empty segment', () => {
    expect(resolveInside(ROOT, 'a//b').ok).toBe(false);
  });

  it('refuses a path with a backslash', () => {
    // `a\b` is one file on unix and two on windows. The snapshot must be
    // identical on every host, so the name is refused rather than
    // guessed at.
    expect(resolveInside(ROOT, 'a\\b').ok).toBe(false);
  });

  it('refuses a climb into a sibling of the root', () => {
    // The sibling-prefix trap: a naive `startsWith('/snapshots')` on the
    // joined string would accept `/snapshots-evil`. The walk refuses it,
    // because the climb has nothing to pop.
    const result = resolveInside('/snapshots', '../snapshots-evil/x');
    expect(result.ok).toBe(false);
  });

  it('refuses a climb out of the root and into its own parent', () => {
    const result = resolveInside('/snapshots', '../snapshots/x');
    expect(result.ok).toBe(false);
  });
});

describe('the link target resolver', () => {
  it('resolves a relative target in the same directory', () => {
    const result = resolveLinkTarget(ROOT, 'link', 'target.txt');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe('/snapshots/target.txt');
    }
  });

  it('resolves a relative target in a subdirectory', () => {
    const result = resolveLinkTarget(ROOT, 'sub/link', '../target.txt');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe('/snapshots/target.txt');
    }
  });

  it('refuses an absolute target', () => {
    // The member's *name* may be perfectly innocent — the escape is in
    // the target, and no name check can see it.
    const result = resolveLinkTarget(ROOT, 'link', '/etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('absolute');
    }
  });

  it('refuses a target that climbs out', () => {
    const result = resolveLinkTarget(ROOT, 'link', '../../etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('refuses a target that climbs out of a subdirectory', () => {
    const result = resolveLinkTarget(ROOT, 'sub/link', '../../escape');
    expect(result.ok).toBe(false);
  });

  it('refuses an empty target', () => {
    expect(resolveLinkTarget(ROOT, 'link', '').ok).toBe(false);
  });
});
