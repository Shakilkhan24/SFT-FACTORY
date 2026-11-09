/**
 * A minimal glob matcher for the protected-path set.
 *
 * pack 03 §4.7's `protectedPaths` use a small, well-defined glob dialect:
 *
 * ```
 * ".github/**"              "CODEOWNERS"       ".factory/**"
 * "tests/acceptance/**"     "**\/migrations/**" "Dockerfile*"
 * "docker-compose*.y*ml"
 * ```
 *
 * The dialect is deliberately small — no character classes, no braces, no
 * alternation:
 *
 * * `*` matches any run of characters **within one path segment**, so
 *   `Dockerfile*` matches `Dockerfile` and `Dockerfile.dev` but not
 *   `docker/Dockerfile`.
 * * `**` matches any number of path segments, including none, so `a/**`
 *   matches `a/b`, `a/b/c` and (because it also matches nothing) `a`.
 * * `?` matches exactly one character.
 *
 * The matcher is **pure** and dependency-free: no filesystem, no glob
 * library. A policy rule must be evaluable identically on any machine, and
 * the paths it matches are strings the caller already has.
 *
 * A glob library would be a third-party dependency in a *pure* package, and
 * the dependency rules forbid I/O-performing dependencies; the dialect above
 * is small enough that implementing it is cheaper than arguing about one.
 */

/**
 * Whether `path` matches `pattern`.
 *
 * The path is compared in POSIX form: backslashes are normalised to `/` and a
 * leading `./` is stripped, because a rule that matches `src/index.ts` must
 * also match `./src/index.ts`.
 */
export const matchesGlob = (pattern: string, path: string): boolean => {
  const normalisedPath = normalisePath(path);
  const normalisedPattern = normalisePath(pattern);
  return matchSegments(splitSegments(normalisedPattern), splitSegments(normalisedPath));
};

/**
 * Whether `path` matches **any** of the patterns.
 */
export const matchesAnyGlob = (
  patterns: readonly string[],
  path: string,
): boolean => patterns.some((pattern) => matchesGlob(pattern, path));

/**
 * Normalise a path for comparison: backslashes to `/`, no leading `./`, no
 * trailing `/`.
 */
const normalisePath = (value: string): string => {
  const slashed = value.replace(/\\/g, '/');
  const withoutPrefix = slashed.startsWith('./') ? slashed.slice(2) : slashed;
  return withoutPrefix.length > 1 && withoutPrefix.endsWith('/')
    ? withoutPrefix.slice(0, -1)
    : withoutPrefix;
};

/**
 * Split a path into its segments, dropping empty ones.
 *
 * A leading `/` is dropped too, so an absolute path and a relative one
 * compare the same — the rule set is written relative to the repository
 * root.
 */
const splitSegments = (value: string): string[] =>
  value.split('/').filter((segment) => segment.length > 0);

/**
 * Match a pattern's segments against a path's segments.
 *
 * The recursion carries the index into each list, so `**` can consume any
 * number of path segments at once.
 */
const matchSegments = (
  pattern: readonly string[],
  path: readonly string[],
): boolean => {
  if (pattern.length === 0) {
    return path.length === 0;
  }

  const head = pattern[0] as string;

  if (head === '**') {
    // `**` matches zero or more segments. Try consuming none, then one more.
    for (let consumed = 0; consumed <= path.length; consumed += 1) {
      if (matchSegments(pattern.slice(1), path.slice(consumed))) {
        return true;
      }
    }
    return false;
  }

  if (path.length === 0) {
    return false;
  }

  if (!matchSegment(head, path[0] as string)) {
    return false;
  }

  return matchSegments(pattern.slice(1), path.slice(1));
};

/**
 * Match one pattern segment against one path segment.
 *
 * `*` matches any run of characters within the segment, `?` matches exactly
 * one.
 */
const matchSegment = (pattern: string, segment: string): boolean => {
  let patternIndex = 0;
  let segmentIndex = 0;
  let starIndex = -1;
  let matchIndex = 0;

  while (segmentIndex < segment.length) {
    const patternChar = pattern[patternIndex];
    const segmentChar = segment[segmentIndex];

    if (patternChar === '?' || patternChar === segmentChar) {
      patternIndex += 1;
      segmentIndex += 1;
      continue;
    }

    if (patternChar === '*') {
      starIndex = patternIndex;
      matchIndex = segmentIndex;
      patternIndex += 1;
      continue;
    }

    if (starIndex !== -1) {
      // Backtrack: let the last `*` swallow one more character.
      patternIndex = starIndex + 1;
      matchIndex += 1;
      segmentIndex = matchIndex;
      continue;
    }

    return false;
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === '*') {
    patternIndex += 1;
  }

  return patternIndex === pattern.length;
};
