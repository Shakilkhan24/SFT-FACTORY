/**
 * A tiny glob matcher for `Allowed-paths:` declarations.
 *
 * Deliberately small and deliberately strict: it supports `*` (anything
 * except `/`), `**` (anything, including `/`), `?` (one character) and
 * `{a,b}` alternatives. It does NOT support `~`, negation, or character
 * classes — an allow-list that can express "everything except" is not an
 * allow-list.
 *
 * A glob that is not a literal path is matched against the FULL path, and a
 * glob that starts with `/` is anchored to the repository root.
 */

/**
 * Compile a glob into a regular expression.
 *
 * @param glob the glob pattern
 * @returns a regular expression matching the whole path
 */
export const globToRegExp = (glob: string): RegExp => {
  let pattern = '';
  let i = 0;

  while (i < glob.length) {
    const char = glob[i];

    if (char === '*') {
      const isDouble = glob[i + 1] === '*';
      if (isDouble) {
        // `**/` should also match zero directories.
        if (glob[i + 2] === '/') {
          pattern += '(?:.*/)?';
          i += 3;
          continue;
        }
        pattern += '.*';
        i += 2;
        continue;
      }
      pattern += '[^/]*';
      i += 1;
      continue;
    }

    if (char === '?') {
      pattern += '[^/]';
      i += 1;
      continue;
    }

    if (char === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        // Unbalanced brace — treat it as a literal.
        pattern += '\\{';
        i += 1;
        continue;
      }
      const alternatives = glob
        .slice(i + 1, close)
        .split(',')
        .map((alternative) => alternative.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
      pattern += `(?:${alternatives.join('|')})`;
      i = close + 1;
      continue;
    }

    pattern += (char ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }

  const anchored = glob.startsWith('/');
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${pattern}$`);
};
