/**
 * The **tar reader**, against a **real** `git archive`.
 *
 * The other tar tests use the archive builder, so they prove the reader
 * and the builder agree. That is not enough: a reader that mis-parses
 * real git output would pass every one of them and fail in production.
 *
 * So this test runs `git archive` for **real**, in a temp repository, and
 * reads the result. It is skipped when git is not on the PATH.
 *
 * The repository is created in a temp directory and removed afterwards.
 * Nothing outside the temp directory is touched, and no network is
 * reached.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readTar } from '../../packages/isolation/src/index.ts';

/**
 * Is git on the PATH?
 */
const gitAvailable = (): boolean => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const available = gitAvailable();

let repository = '';
let archive: Uint8Array;

beforeAll(() => {
  if (!available) {
    return;
  }
  repository = mkdtempSync(join(tmpdir(), 'isolation-tar-'));
  const run = (args: readonly string[]): void => {
    execFileSync('git', [...args], { cwd: repository, stdio: 'ignore' });
  };
  run(['init', '-q', '.']);
  run(['config', 'user.email', 'factory@example.invalid']);
  run(['config', 'user.name', 'factory']);
  writeFileSync(join(repository, 'README.md'), 'hello\n');
  writeFileSync(join(repository, 'nested.txt'), 'nested\n');
  execFileSync('mkdir', ['-p', join(repository, 'src', 'deep')], { stdio: 'ignore' });
  writeFileSync(join(repository, 'src', 'deep', 'file.ts'), 'export const x = 1;\n');
  run(['add', '-A']);
  run(['commit', '-qm', 'the commit']);
  archive = new Uint8Array(
    execFileSync('git', ['archive', '--format=tar', 'HEAD'], {
      cwd: repository,
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
});

afterAll(() => {
  if (repository.length > 0) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe('the tar reader, against a real git archive', () => {
  it('reads the members git produced', () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const members = readTar(archive);
    const names = members.map((member) => member.name).sort();
    expect(names).toContain('README.md');
    expect(names).toContain('nested.txt');
    expect(names).toContain('src/deep/file.ts');
  });

  it('reads a file’s contents exactly', () => {
    if (!available) {
      return;
    }
    const members = readTar(archive);
    const readme = members.find((member) => member.name === 'README.md');
    expect(readme?.type).toBe('file');
    if (readme?.type === 'file') {
      expect(Buffer.from(readme.contents).toString('utf8')).toBe('hello\n');
      expect(readme.size).toBe(6);
    }
  });

  it('reads a file’s contents that are not valid UTF-8', () => {
    // A snapshot is a faithful copy. A reader that decoded the bytes as
    // text would mangle a binary file — and a source repository can hold
    // one.
    if (!available) {
      return;
    }
    const binary = Uint8Array.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x7f]);
    execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repository,
      input: binary,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repository,
      input: binary,
    })
      .toString('utf8')
      .trim();
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${blob},binary.bin`], {
      cwd: repository,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-qm', 'binary'], {
      cwd: repository,
      stdio: 'ignore',
    });
    const withBinary = new Uint8Array(
      execFileSync('git', ['archive', '--format=tar', 'HEAD'], {
        cwd: repository,
        maxBuffer: 32 * 1024 * 1024,
      }),
    );
    const members = readTar(withBinary);
    const file = members.find((member) => member.name === 'binary.bin');
    expect(file?.type).toBe('file');
    if (file?.type === 'file') {
      expect([...file.contents]).toEqual([...binary]);
    }
  });

  it('reads the directories git produced', () => {
    if (!available) {
      return;
    }
    const members = readTar(archive);
    const directories = members
      .filter((member) => member.type === 'directory')
      .map((member) => member.name);
    expect(directories).toContain('src');
  });
});

describe('the tar builder’s hard link', () => {
  it('produces a member the reader reports as a hard link', async () => {
    const { buildTar } = await import(
      '../../packages/isolation/src/t1/fakes/tar-builder.ts'
    );
    const archive = buildTar([
      { name: 'hard', type: '1', target: '/etc/passwd' },
    ]);
    const members = readTar(archive);
    expect(members.map((m) => m.type)).toEqual(['hardlink']);
  });
});
