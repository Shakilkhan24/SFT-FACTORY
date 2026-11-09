#!/usr/bin/env node
/**
 * `tools/coverage-check` — the requirement-coverage gate (T-0.02).
 *
 * Pack 05, T-0.02: "fails CI if any requirement id in
 * `blueprint-reference/06_REQUIREMENTS_AND_NFRS.md` is missing from `06_…`
 * Part C, or its tally is stale. (Part C tallies 99 requirements:
 * ✅ 75 · 🟡 12 · ⏸ 10 · ◻ 2.)"
 *
 * Two claims, both checked here:
 *
 *   1. COVERAGE — every requirement id declared in the blueprint's
 *      requirements document appears as a row in the pack's Part C matrix.
 *      A requirement nobody mapped is a requirement nobody is building.
 *
 *   2. TALLY — Part C's own headline tallies match the status glyphs actually
 *      present in its rows. A stale tally means the matrix stopped being
 *      maintained, which is the same failure as a missing row, quieter.
 *
 * Read-only: this script writes nothing, anywhere.
 *
 * Usage: `node tools/coverage-check.mjs [--pack <dir>] [--blueprint <dir>]`
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The requirement-id families the blueprint declares. */
const REQUIREMENT_ID = /\b((?:FR|NFR|SEC|MEAS)-\d{2,3})\b/g;

const STATUS_GLYPHS = {
  '✅': 'covered',
  '🟡': 'partial',
  '⏸': 'deferred',
  '◻': 'absence',
};

/** The tally Part C claims for itself, in its own heading. */
const EXPECTED_TALLY = { total: 99, covered: 75, partial: 12, deferred: 10, absence: 2 };

const locatePack = (explicit) => {
  const candidates = explicit
    ? [explicit]
    : [
        join(repoRoot, 'docs', 'pack'),
        join(repoRoot, 'software-factory-pack', 'software-factory-pack'),
      ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, '06_MASTER_CHECKLIST_AND_COVERAGE.md'))) {
      return candidate;
    }
  }
  return null;
};

const locateBlueprint = (explicit, packDir) => {
  const candidates = explicit
    ? [explicit]
    : [
        join(packDir, 'blueprint-reference'),
        join(repoRoot, 'docs', 'pack', 'blueprint-reference'),
      ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, '06_REQUIREMENTS_AND_NFRS.md'))) {
      return candidate;
    }
  }
  return null;
};

/** The Part C section body — from its heading to the next `## ` heading. */
const partCBody = (masterChecklist) => {
  const start = masterChecklist.indexOf('## Part C');
  if (start === -1) {
    return null;
  }
  const rest = masterChecklist.slice(start + '## Part C'.length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
};

const requirementRows = (body) => {
  const rows = new Map();
  for (const line of body.split('\n')) {
    if (!line.startsWith('|')) {
      continue;
    }
    const cells = line.split('|').map((cell) => cell.trim());
    // cells[0] is empty (leading pipe), cells[1] is the id.
    const id = cells[1];
    if (!id || !/^(?:FR|NFR|SEC|MEAS)-\d{2,3}$/.test(id)) {
      continue;
    }
    rows.set(id, { status: cells[2] ?? '', note: cells[4] ?? '' });
  }
  return rows;
};

const blueprintRequirementIds = (requirementsDoc) => {
  const ids = new Set();
  for (const match of requirementsDoc.matchAll(REQUIREMENT_ID)) {
    ids.add(match[1]);
  }
  return ids;
};

const main = async () => {
  const argv = process.argv.slice(2);
  const argValue = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const packDir = locatePack(argValue('--pack'));
  if (!packDir) {
    console.error('FAIL  cannot locate the pack (docs/pack or software-factory-pack/software-factory-pack)');
    process.exit(1);
  }

  const blueprintDir = locateBlueprint(argValue('--blueprint'), packDir);
  if (!blueprintDir) {
    console.error('FAIL  cannot locate blueprint-reference/06_REQUIREMENTS_AND_NFRS.md');
    process.exit(1);
  }

  const masterChecklist = await readFile(
    join(packDir, '06_MASTER_CHECKLIST_AND_COVERAGE.md'),
    'utf8',
  );
  const requirementsDoc = await readFile(
    join(blueprintDir, '06_REQUIREMENTS_AND_NFRS.md'),
    'utf8',
  );

  const failures = [];

  const body = partCBody(masterChecklist);
  if (body === null) {
    console.error('FAIL  pack 06 has no "## Part C" section');
    process.exit(1);
  }

  const rows = requirementRows(body);
  const declared = blueprintRequirementIds(requirementsDoc);

  // 1. COVERAGE — every blueprint requirement appears in Part C.
  const missing = [...declared].filter((id) => !rows.has(id)).sort();
  if (missing.length > 0) {
    failures.push(
      `Part C is missing ${missing.length} requirement(s) declared in the blueprint: ${missing.join(', ')}`,
    );
  }

  // 2. TALLY — Part C's status glyphs match its own claimed counts.
  const counts = { covered: 0, partial: 0, deferred: 0, absence: 0 };
  const unknownStatus = [];
  for (const [id, row] of rows) {
    const glyph = Object.keys(STATUS_GLYPHS).find((candidate) => row.status.startsWith(candidate));
    if (glyph === undefined) {
      unknownStatus.push(`${id} (status ${JSON.stringify(row.status)})`);
      continue;
    }
    counts[STATUS_GLYPHS[glyph]] += 1;
  }
  if (unknownStatus.length > 0) {
    failures.push(`Part C rows with an unrecognised status: ${unknownStatus.join(', ')}`);
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const tallyChecks = [
    ['total', total, EXPECTED_TALLY.total],
    ['covered', counts.covered, EXPECTED_TALLY.covered],
    ['partial', counts.partial, EXPECTED_TALLY.partial],
    ['deferred', counts.deferred, EXPECTED_TALLY.deferred],
    ['absence', counts.absence, EXPECTED_TALLY.absence],
  ];
  for (const [name, actual, expected] of tallyChecks) {
    if (actual !== expected) {
      failures.push(`Part C ${name} tally is stale: found ${actual}, expected ${expected}`);
    }
  }

  if (failures.length > 0) {
    console.error('FAIL  requirement coverage');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `ok  requirements: ${declared.size} declared in the blueprint, all mapped in Part C`,
  );
  console.log(
    `ok  tally: ${total} rows (✅ ${counts.covered} · 🟡 ${counts.partial} · ⏸ ${counts.deferred} · ◻ ${counts.absence})`,
  );
  console.log('ALL REQUIREMENT COVERAGE VERIFIED AGAINST THE BLUEPRINT');
};

await main();
