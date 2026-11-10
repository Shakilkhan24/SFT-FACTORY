/**
 * `t1/tar` — **the tar reader** (T-1.12).
 *
 * ## Why a hand-written reader
 *
 * `git archive` produces a **tar** stream. The stream has to be read
 * somewhere, and the reading has to enforce the traversal rules, because
 * the rules are about *members* and a member is only known once the stream
 * is parsed.
 *
 * The repository has no tar dependency, and adding one is not the ticket's
 * business. So this is a **minimal ustar reader** — enough to read what
 * `git archive` emits, and nothing more.
 *
 * ## What it reads
 *
 * The **ustar** format, as git emits it:
 *
 * | offset | size | field |
 * |---|---|---|
 * | 0 | 100 | the member's name |
 * | 100 | 8 | the mode |
 * | 108 | 8 | the uid |
 * | 116 | 8 | the gid |
 * | 124 | 12 | the size, octal |
 * | 136 | 12 | the modification time, octal |
 * | 148 | 8 | the checksum |
 * | 156 | 1 | the type flag |
 * | 157 | 100 | the link target, for a link |
 * | 257 | 6 | the ustar magic |
 * | 263 | 2 | the ustar version |
 *
 * The type flags that matter here:
 *
 * - `'0'` — a **regular file**. The size field says how many bytes follow.
 * - `'5'` — a **directory**. The size is zero.
 * - `'2'` — a **symlink**. The link target is in the 157-offset field.
 * - `'1'` — a **hard link**. The link target names a member of the archive.
 * - `'g'` — a **pax global header**. Git emits one at the head of every
 *   archive, carrying the commit's id and its time. It is metadata, not a
 *   file, and it is **skipped** — but its payload has to be consumed, or
 *   the next header would be read at the wrong offset.
 * - `'x'` — a **pax extended header**. It precedes one member and may
 *   override that member's name with a `path=` record — which is how a
 *   name longer than 100 bytes is carried. The override is honoured,
 *   because a long path is exactly the case where the 100-byte field
 *   truncates.
 *
 * ## What it refuses
 *
 * A member whose name escapes the root is refused **before** anything is
 * written. A symlink whose target escapes is refused before the link is
 * created. A hard link is refused outright — git's archives do not contain
 * them, and a hard link to a member outside the archive is an escape that
 * no name check can see.
 *
 * ## The end-of-archive marker
 *
 * A tar stream ends with **two** 512-byte blocks of zeros. One block of
 * zeros is a member with an empty name, and is not the end. Reading only
 * one would truncate the archive.
 */

/**
 * A member of a tar archive, as the reader sees it.
 *
 * The reader reports the member's **metadata** and, for a regular file, its
 * **contents**. The contents are handed over as a buffer rather than
 * streamed, because a snapshot's files are source files — small — and the
 * buffer makes the "the file's size matches its header" check trivial.
 */
export type TarMember =
  | {
      readonly type: 'file';
      readonly name: string;
      readonly size: number;
      readonly contents: Uint8Array;
      readonly mode: number;
    }
  | {
      readonly type: 'directory';
      readonly name: string;
      readonly mode: number;
    }
  | {
      readonly type: 'symlink';
      readonly name: string;
      readonly target: string;
      readonly mode: number;
    }
  | {
      readonly type: 'hardlink';
      readonly name: string;
      readonly target: string;
      readonly mode: number;
    };

/**
 * The size of a tar header block.
 */
const BLOCK = 512;

/**
 * The tar header's field offsets.
 */
const OFFSET_NAME = 0;
const OFFSET_MODE = 100;
const OFFSET_SIZE = 124;
const OFFSET_TYPEFLAG = 156;
const OFFSET_LINK = 157;
const OFFSET_MAGIC = 257;

/**
 * Read a NUL-terminated string field.
 */
const readString = (
  block: Uint8Array,
  offset: number,
  length: number,
): string => {
  let end = offset;
  const limit = offset + length;
  while (end < limit && block[end] !== 0) {
    end += 1;
  }
  return Buffer.from(block.subarray(offset, end)).toString('utf8');
};

/**
 * Read an **octal** numeric field.
 *
 * A field may be empty (meaning zero) and may be terminated by a NUL or a
 * space, so both are tolerated.
 */
const readOctal = (
  block: Uint8Array,
  offset: number,
  length: number,
): number => {
  const raw = readString(block, offset, length).trim();
  if (raw.length === 0) {
    return 0;
  }
  // A base-256 encoding (the high bit set) is used for values that do not
  // fit in octal. `git archive` does not emit one for the fields read
  // here, but a hand-crafted archive could, and silently reading it as
  // octal would misreport the size.
  const first = block[offset];
  if (first !== undefined && first > 0x7f) {
    throw new Error('the tar header uses base-256 encoding, which is not supported');
  }
  const value = Number.parseInt(raw, 8);
  if (!Number.isFinite(value)) {
    throw new Error(`the tar header field at ${offset} is not an octal number`);
  }
  return value;
};

/**
 * The archive is malformed.
 *
 * Thrown, not returned: a malformed archive is a **programmer or
 * environment** error, not hostile input. (Hostile input — a member that
 * escapes — is *returned* as a refusal, because that is an expected
 * outcome.)
 */
export class TarFormatError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TarFormatError';
  }
};

/**
 * Read the **pax records** in an extended header's payload.
 *
 * A pax payload is a sequence of `"<length> <key>=<value>\n"` records,
 * where the length counts the record itself. Only `path` and `linkpath`
 * matter to the reader: they carry the member's name and its link target
 * when either is longer than the 100-byte header field.
 */
const readPaxRecords = (
  payload: Uint8Array,
): Readonly<Record<string, string>> => {
  const records: Record<string, string> = {};
  const text = Buffer.from(payload).toString('utf8');
  let cursor = 0;
  while (cursor < text.length) {
    const space = text.indexOf(' ', cursor);
    if (space === -1) {
      break;
    }
    const length = Number.parseInt(text.slice(cursor, space), 10);
    if (!Number.isFinite(length) || length <= 0) {
      break;
    }
    const record = text.slice(space + 1, cursor + length).replace(/\n$/, '');
    const equals = record.indexOf('=');
    if (equals > 0) {
      records[record.slice(0, equals)] = record.slice(equals + 1);
    }
    cursor += length;
  }
  return records;
};

/**
 * Read every member of a tar archive.
 *
 * @param bytes the whole archive
 */
export const readTar = (bytes: Uint8Array): readonly TarMember[] => {
  const members: TarMember[] = [];
  let offset = 0;
  let zeroBlocks = 0;

  // The pax extended header's overrides, carried to the **next** member.
  let pendingPath: string | undefined;
  let pendingLinkPath: string | undefined;

  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);

    // An all-zero block is either the end of the archive or the first of
    // the two zero blocks that end it.
    let isZero = true;
    for (const byte of header) {
      if (byte !== 0) {
        isZero = false;
        break;
      }
    }
    if (isZero) {
      zeroBlocks += 1;
      offset += BLOCK;
      if (zeroBlocks === 2) {
        return members;
      }
      continue;
    }
    zeroBlocks = 0;

    const magic = readString(header, OFFSET_MAGIC, 6);
    if (magic !== 'ustar' && magic !== 'ustar  ' && magic !== '') {
      throw new TarFormatError(
        `the tar block at ${offset} is not a ustar header (magic "${magic}")`,
      );
    }

    const headerName = readString(header, OFFSET_NAME, 100);
    const mode = readOctal(header, OFFSET_MODE, 8);
    const size = readOctal(header, OFFSET_SIZE, 12);
    const typeFlag = String.fromCharCode(header[OFFSET_TYPEFLAG] ?? 0);

    offset += BLOCK;

    // A pax header — global or extended — is **metadata**, not a file.
    // Its payload has to be consumed so the next header is read at the
    // right offset, and its `path=` record overrides the next member's
    // name.
    if (typeFlag === 'g' || typeFlag === 'x') {
      if (offset + size > bytes.length) {
        throw new TarFormatError(
          `the pax header "${headerName}" claims ${size} bytes but the archive ends first`,
        );
      }
      const records = readPaxRecords(bytes.subarray(offset, offset + size));
      offset += Math.ceil(size / BLOCK) * BLOCK;
      if (typeFlag === 'x') {
        pendingPath = records['path'];
        pendingLinkPath = records['linkpath'];
      }
      continue;
    }

    // The pax `path=` record wins over the 100-byte name field, which is
    // truncated for a long name.
    const name = (pendingPath ?? headerName).replace(/\/+$/, '');
    pendingPath = undefined;

    let contents: Uint8Array = new Uint8Array(0);
    if (typeFlag === '0' || typeFlag === '\0') {
      if (offset + size > bytes.length) {
        throw new TarFormatError(
          `the tar member "${name}" claims ${size} bytes but the archive ends first`,
        );
      }
      contents = bytes.subarray(offset, offset + size);
      // The payload is padded to a block boundary.
      offset += Math.ceil(size / BLOCK) * BLOCK;
    } else if (typeFlag === '5') {
      // A directory carries no payload.
    } else if (typeFlag === '2') {
      // A symlink carries no payload; the target is in the header.
    } else if (typeFlag === '1') {
      // A hard link names another member of the archive. It is read so the
      // reader can report it, and refused by the caller.
      const target = pendingLinkPath ?? readString(header, OFFSET_LINK, 100);
      pendingLinkPath = undefined;
      members.push({ type: 'hardlink', name, target, mode });
      continue;
    } else if (typeFlag === 'L') {
      // A GNU long name: the next header is the real name.
      throw new TarFormatError(
        'the tar archive uses a GNU long-name extension, which is not supported',
      );
    } else {
      throw new TarFormatError(
        `the tar member "${name}" has the unsupported type flag "${typeFlag}"`,
      );
    }

    if (typeFlag === '5') {
      members.push({ type: 'directory', name, mode });
    } else if (typeFlag === '2') {
      const target = pendingLinkPath ?? readString(header, OFFSET_LINK, 100);
      pendingLinkPath = undefined;
      members.push({ type: 'symlink', name, target, mode });
    } else {
      members.push({ type: 'file', name, size, contents, mode });
    }
  }

  if (members.length === 0) {
    throw new TarFormatError('the tar archive is empty');
  }
  return members;
};
