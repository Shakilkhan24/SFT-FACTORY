#!/usr/bin/env node
/**
 * `tools/oracle-guard` — CLI entry point.
 *
 * Fails if the PR modifies an oracle path without human authorship or an
 * `oracle-approved` label.
 *
 * Environment (GitHub Actions):
 *   CHANGED_PATHS        newline-separated changed paths
 *   PR_LABELS            comma-separated label names
 *   HUMAN_AUTHORED       "true" when every commit carries a verified signature
 *
 * When `HUMAN_AUTHORED` is not set at all, the commit list could not be
 * obtained and the guard fails closed on any oracle edit.
 */

import { checkOracle, formatVerdict } from './guards/oracle-guard.ts';

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const USAGE = `usage: tools/oracle-guard [--changed <path> | --changed-from-stdin]`;

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

  let changedPaths: string[];
  const changedArg = argValue('--changed');
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

  const labels = (process.env.PR_LABELS ?? '')
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
  const hasOracleApproved = labels.includes('oracle-approved');

  const commitsAvailable = process.env.HUMAN_AUTHORED !== undefined;
  const allCommitsHuman =
    commitsAvailable && (process.env.HUMAN_AUTHORED ?? '').toLowerCase() === 'true';

  const verdict = checkOracle({
    changedPaths,
    allCommitsHuman,
    hasOracleApproved,
    commitsAvailable,
  });

  console.log(formatVerdict(verdict));
  process.exit(verdict.ok ? 0 : 1);
};

await main();
