/**
 * `t1/paths` — **the path-safety helper** (T-1.12).
 *
 * ## Why this file exists
 *
 * A T1 snapshot is a `git archive` of a base SHA, extracted onto the host.
 * `git archive` produces a **tar stream**, and a tar member's name is
 * attacker-influenced data: a member called `../../etc/cron.d/x` escapes the
 * snapshot root the moment it is written. So the safety of a snapshot is
 * decided **per member, during extraction** — not once, on the request.
 *
 * The repository had no general path-safety helper. The closest thing,
 * `packages/definition/src/capability-registry.ts`, is a **string** check on
 * a schema ref:
 *
 * ```ts
 * if (!ref.startsWith('schemas/') || ref.includes('..')) {
 *   return { ok: false, reason: '…' };
 * }
 * ```
 *
 * That is sufficient for a ref into a known set of files, and **not**
 * sufficient for a tar member: `a/../../b` contains `..` but does not escape,
 * and `..` is not the only escape (an absolute path is another, and a
 * symlink whose target is absolute is a third).
 *
 * So T-1.12 writes the canonical helper, and the rest of the package uses
 * it. Every refusal is a **return**, never a throw — the repo's convention
 * (`tools/guards/*.ts`, and `packages/contracts/src/state.ts`'s guard
 * results). A refusal is an *expected* outcome of hostile input, not a
 * programmer error.
 */

/**
 * The result of a path check.
 *
 * A discriminated union rather than a thrown error, so a caller **cannot**
 * forget to handle the refusal: the `ok: false` branch carries the reason
 * and the type forces the caller to narrow.
 */
export type PathCheck =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The **40-hex** form of a git object name.
 *
 * A SHA is the snapshot's key and it becomes a **directory name**, so it is
 * validated before it reaches a path. This is the same discipline as
 * `tools/worktree.sh`'s ticket-id validator:
 *
 * ```sh
 * if ! printf '%s' "$TICKET" | grep -Eq '^T-[0-9]+\.[0-9]+'; then
 *   echo "worktree: refusing ticket id '$TICKET' …" >&2
 * ```
 *
 * A SHA is **lower-case** hex: git's own `rev-parse` emits lower-case, and
 * accepting an upper-case form would give two directory names for one
 * commit.
 */
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Is this a 40-hex git object name?
 *
 * The check is deliberately *exact*: a short SHA, a 64-hex SHA (SHA-256
 * repositories), a ref name (`HEAD`, `main`) and a path (`../../etc`) are
 * all refused. A snapshot is keyed by a **commit**, and a commit's name is
 * unambiguous; anything else would be a guess.
 */
export const isSha = (value: string): boolean => SHA_PATTERN.test(value);

/**
 * Validate a base SHA, returning a refusal rather than a boolean so the
 * caller can report *why*.
 */
export const checkSha = (value: string): PathCheck => {
  if (value.length === 0) {
    return { ok: false, reason: 'the base SHA is empty' };
  }
  if (!SHA_PATTERN.test(value)) {
    return {
      ok: false,
      reason:
        `the base SHA "${value}" is not a 40-character lower-case hex commit name`,
    };
  }
  return { ok: true, path: value };
};

/**
 * The path separator used when a tar member's name is normalised.
 *
 * Tar member names use `/` regardless of the host, so the normalisation is
 * done on `/` and the result is handed to the host's path API. A member
 * named `a\b` is a **single** file on unix and two on Windows; it is
 * refused rather than guessed at, because the snapshot must be identical on
 * every host.
 */
const isWindowsStyleSeparator = (name: string): boolean => name.includes('\\');

/**
 * Why a name could not be normalised.
 *
 * The reasons are **distinct** because a refusal that names its reason is
 * the only way a specific check can be observed. When every malformed name
 * was refused with one generic message, an absolute path and a name with
 * an empty segment produced the same refusal — and a test asserting
 * either one would pass even if the check it meant were gone. The
 * mutation harness caught exactly that.
 */
type NormalisationFailure =
  | 'empty'
  | 'absolute'
  | 'separator'
  | 'empty-segment'
  | 'dot-segment';

/**
 * Normalise a tar member's name into its path segments.
 *
 * Returns `undefined` for a name that cannot be normalised — an absolute
 * path, a name with a `\` in it, or a name with an empty segment (which is
 * what `a//b` produces).
 *
 * A `..` segment is **kept**, not rejected: whether it escapes depends on
 * where it is, and only the walk can tell. `a/../b` stays inside;
 * `a/../../b` does not.
 */
const segmentsOf = (
  name: string,
): { readonly ok: true; readonly segments: readonly string[] } | { readonly ok: false; readonly failure: NormalisationFailure } => {
  if (name.length === 0) {
    return { ok: false, failure: 'empty' };
  }
  if (isWindowsStyleSeparator(name)) {
    return { ok: false, failure: 'separator' };
  }
  // An absolute path is an escape, not a path.
  if (name.startsWith('/')) {
    return { ok: false, failure: 'absolute' };
  }
  const segments = name.split('/');
  for (const segment of segments) {
    if (segment.length === 0) {
      return { ok: false, failure: 'empty-segment' };
    }
    if (segment === '.') {
      return { ok: false, failure: 'dot-segment' };
    }
  }
  return { ok: true, segments };
};

/**
 * The refusal message for a failed normalisation.
 */
const normalisationReason = (
  name: string,
  failure: NormalisationFailure,
): string => {
  switch (failure) {
    case 'empty':
      return `the path "${name}" is empty`;
    case 'absolute':
      return `the path "${name}" is absolute, so it is not a path inside the snapshot`;
    case 'separator':
      return `the path "${name}" contains a backslash, which is not portable`;
    case 'empty-segment':
      return `the path "${name}" has an empty segment`;
    case 'dot-segment':
      return `the path "${name}" has a "." segment`;
  }
};

/**
 * Resolve a **relative** path against a root, refusing anything that leaves
 * the root.
 *
 * This is the core of the traversal defence. The resolution is done on
 * **segments**, not on the joined string, so `a/../../b` is refused — a
 * string check for `..` would refuse it too, but it would also refuse the
 * harmless `a/../b`, and, worse, a naive `startsWith(root)` check on the
 * joined string would accept `/root-evil` for a root of `/root`.
 *
 * @param root the directory the result must stay inside
 * @param candidate the relative path to resolve
 */
export const resolveInside = (root: string, candidate: string): PathCheck => {
  const normalised = segmentsOf(candidate);
  if (!normalised.ok) {
    return {
      ok: false,
      reason: normalisationReason(candidate, normalised.failure),
    };
  }
  const segments = normalised.segments;

  const rootParts = root.split('/').filter((part) => part.length > 0);

  // The walk. `..` pops a segment; if there is nothing to pop, the path
  // climbs above the root and is refused. This is what separates
  // `a/../b` (inside) from `a/../../b` (outside).
  //
  // The walk is the **whole** rule. A joined-string check on top of it
  // would be redundant: the walk cannot produce a path outside the root
  // when it refuses every climb that has nothing to pop. An earlier
  // version of this file had such a check, and the mutation harness
  // proved it unobservable — a check that cannot fail is not a check.
  const walked: string[] = [];
  for (const segment of segments) {
    if (segment === '..') {
      if (walked.length === 0) {
        return {
          ok: false,
          reason: `the path "${candidate}" resolves outside "${root}"`,
        };
      }
      walked.pop();
      continue;
    }
    walked.push(segment);
  }

  const joined = `/${[...rootParts, ...walked].join('/')}`;

  return { ok: true, path: joined };
};

/**
 * Resolve a tar member's **link target** against the directory the link
 * lives in.
 *
 * A symlink in a snapshot is a promise that some other path exists. If the
 * target is absolute, or escapes the snapshot, then following the link
 * reads or writes **outside** the snapshot — which is exactly the escape a
 * member-name check cannot see, because the member's *name* may be perfectly
 * innocent (`link`) while its *target* is not.
 *
 * A link target that is absolute is refused rather than re-rooted: a
 * snapshot is a faithful copy, and a faithful copy of an absolute symlink
 * would point outside the snapshot.
 *
 * @param root the snapshot root
 * @param memberName the link's own name, relative to the root
 * @param target the link's target, as written in the archive
 */
export const resolveLinkTarget = (
  root: string,
  memberName: string,
  target: string,
): PathCheck => {
  if (target.length === 0) {
    return { ok: false, reason: `the link "${memberName}" has an empty target` };
  }
  if (target.startsWith('/')) {
    return {
      ok: false,
      reason: `the link "${memberName}" points at the absolute path "${target}"`,
    };
  }
  if (isWindowsStyleSeparator(target)) {
    return {
      ok: false,
      reason: `the link "${memberName}" has a target "${target}" that is not portable`,
    };
  }

  // The target is relative to the **directory of the link**, not to the
  // root. That is what a symlink means.
  const normalised = segmentsOf(memberName);
  if (!normalised.ok) {
    return {
      ok: false,
      reason: `the link "${memberName}" has a name that is not a safe relative path: ${normalisationReason(memberName, normalised.failure)}`,
    };
  }
  const linkDir = normalised.segments.slice(0, -1);

  const walked: string[] = [...linkDir];
  for (const segment of target.split('/')) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (walked.length === 0) {
        return {
          ok: false,
          reason: `the link "${memberName}" points outside the snapshot`,
        };
      }
      walked.pop();
      continue;
    }
    walked.push(segment);
  }

  const rootParts = root.split('/').filter((part) => part.length > 0);
  const joined = `/${[...rootParts, ...walked].join('/')}`;
  const rootJoined = `/${rootParts.join('/')}`;
  if (joined !== rootJoined && !joined.startsWith(`${rootJoined}/`)) {
    return {
      ok: false,
      reason: `the link "${memberName}" points outside the snapshot`,
    };
  }

  return { ok: true, path: joined };
};

/**
 * A **safe key** — a name that can be used as a directory name without
 * escaping.
 *
 * The snapshot's key is the base SHA, but the registry is generic, so the
 * key's charset is checked here rather than at each call site. The charset
 * is deliberately narrow: letters, digits, dot, dash and underscore, and it
 * may not be `.` or `..`.
 *
 * The check exists because a key becomes a **path segment**. A key of
 * `../../etc` would place a snapshot outside the root that is supposed to
 * contain it — the same escape the tar members are checked for, arriving
 * through the request instead of through the archive.
 */
export const checkKey = (key: string): PathCheck => {
  if (key.length === 0) {
    return { ok: false, reason: 'the key is empty' };
  }
  if (key === '.' || key === '..') {
    return { ok: false, reason: `the key "${key}" is not a usable directory name` };
  }
  if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    return {
      ok: false,
      reason: `the key "${key}" contains characters that are not safe in a directory name`,
    };
  }
  return { ok: true, path: key };
};
