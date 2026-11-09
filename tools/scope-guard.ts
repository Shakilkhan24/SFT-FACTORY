#!/usr/bin/env node
/**
 * `tools/scope-guard` — CLI entry point.
 *
 * Reads the PR body and the changed paths from the environment (GitHub
 * Actions) or from stdin/arguments (local use), and fails if the diff
 * touches anything outside `Allowed-paths:`.
 *
 * Environment (GitHub Actions):
 *   PR_BODY_FILE   path to a file containing the PR body
 *   CHANGED_PATHS  newline-separated changed paths
 *   PR_BODY        the PR body itself (used if PR_BODY_FILE is absent)
 *
 * Usage:
 *   tools/scope-guard --body-file <path> --changed <path>
 *   tools/scope-guard --body-file <path> --changed-from-stdin
 *   tools/scope-guard --body '<text>' --changed '<path>'
 */

import { readFile } from 'node:fs/promises';

import { checkScope, formatVerdict } from './guards/scope-guard.ts';

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const USAGE = `usage: tools/scope-guard [--body-file <path> | --body <text>] [--changed <path> | --changed-from-stdin]`;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const argValue = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const bodyFile = argValue('--body-file') ?? process.env.PR_BODY_FILE;
  let body: string;
  if (bodyFile) {
    body = await readFile(bodyFile, 'utf8');
  } else if (argValue('--body') !== undefined) {
    body = argValue('--body') ?? '';
  } else if (process.env.PR_BODY) {
    body = process.env.PR_BODY;
  } else {
    body = await readStdin();
  }

  const changedArg = argValue('--changed');
  let changedPaths: string[];
  if (changedArg !== undefined) {
    changedPaths = changedArg.split('\n').map((line) => line.trim()).filter(Boolean);
  } else if (argv.includes('--changed-from-stdin')) {
    changedPaths = (await readStdin())
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } else if (process.env.CHANGED_PATHS) {
    changedPaths = process.env.CHANGED_PATHS.split('\n').map((line) => line.trim()).filter(Boolean);
  } else {
    changedPaths = [];
  }

  const verdict = checkScope({ body, changedPaths });
  console.log(formatVerdict(verdict));
  process.exit(verdict.ok ? 0 : 1);
};

await main();
