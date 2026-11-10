/**
 * `t1/fakes/tar-builder` — the archive builder for the tests.
 *
 * The tests need **hostile** archives: a member named `../escape`, a
 * symlink whose target is absolute, a member with no name. Those cannot be
 * produced by a real repository, so they are built here.
 *
 * The builder writes the same **ustar** layout the reader parses, so a
 * round-trip through it is a real test of the reader and not a test of the
 * builder agreeing with itself: the reader is also exercised against a
 * real `git archive` output in the acceptance path.
 */

/** The tar header block size. */
const BLOCK = 512;

export interface TarEntry {
  /** The member's name. */
  readonly name: string;
  /** The type flag: `'0'` file, `'5'` directory, `'2'` symlink, `'1'` hard link. */
  readonly type?: '0' | '5' | '2' | '1';
  /** The file's contents. */
  readonly contents?: string;
  /** The symlink's or hard link's target. */
  readonly target?: string;
  /** The member's mode, in octal. */
  readonly mode?: number;
}

/**
 * Write an octal field.
 */
const writeOctal = (
  block: Uint8Array,
  offset: number,
  length: number,
  value: number,
): void => {
  const text = value.toString(8).padStart(length - 1, '0');
  for (let i = 0; i < text.length && i < length - 1; i += 1) {
    block[offset + i] = text.charCodeAt(i);
  }
  block[offset + length - 1] = 0;
};

/**
 * Write a NUL-padded string field.
 */
const writeString = (
  block: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void => {
  const bytes = Buffer.from(value, 'utf8');
  const count = Math.min(bytes.length, length - 1);
  for (let i = 0; i < count; i += 1) {
    block[offset + i] = bytes[i] as number;
  }
};

/**
 * Build a tar archive from the entries.
 *
 * The archive ends with **two** zero blocks, as a real tar does.
 */
export const buildTar = (entries: readonly TarEntry[]): Uint8Array => {
  const chunks: Uint8Array[] = [];

  for (const entry of entries) {
    const header = new Uint8Array(BLOCK);
    const type = entry.type ?? '0';
    const contents = Buffer.from(entry.contents ?? '', 'utf8');

    writeString(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, entry.mode ?? 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, type === '0' ? contents.length : 0);
    writeOctal(header, 136, 12, 0);
    // The checksum field is filled with spaces while the checksum is
    // computed, then written as six octal digits, a NUL and a space.
    for (let i = 148; i < 156; i += 1) {
      header[i] = 0x20;
    }
    header[156] = type.charCodeAt(0);
    if (entry.target !== undefined) {
      writeString(header, 157, 100, entry.target);
    }
    writeString(header, 257, 6, 'ustar');
    writeString(header, 263, 2, '00');

    let checksum = 0;
    for (const byte of header) {
      checksum += byte;
    }
    const checksumText = checksum.toString(8).padStart(6, '0');
    for (let i = 0; i < 6; i += 1) {
      header[148 + i] = checksumText.charCodeAt(i);
    }
    header[154] = 0;
    header[155] = 0x20;

    chunks.push(header);

    if (type === '0' && contents.length > 0) {
      const payload = new Uint8Array(Math.ceil(contents.length / BLOCK) * BLOCK);
      payload.set(contents, 0);
      chunks.push(payload);
    }
  }

  // Two zero blocks end the archive.
  chunks.push(new Uint8Array(BLOCK * 2));

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.length;
  }
  return archive;
};
