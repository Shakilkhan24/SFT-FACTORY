#!/usr/bin/env node
/**
 * `tools/extract-pack-ddl` — re-extract the DDL from the pack and compare it
 * with the committed migrations.
 *
 * checklist 02 T-1.02, trap 2: "Hand-writing the DDL instead of using `03` §2
 * verbatim. The pack's DDL is the contract; `validate_ddl.sh` is written
 * against it. A re-typed DDL drifts."
 *
 * `migrations/0001_core.sql` and `migrations/0001_grants.sql` are the pack's
 * two ```sql blocks plus a provenance header. This tool proves that claim
 * mechanically: it re-extracts the blocks from the pack and checks that each
 * migration file *ends with* exactly that block, byte for byte.
 *
 * Usage:
 *   node tools/extract-pack-ddl.ts [--check] [--out <dir>]
 *
 * `--check` (the default in CI) verifies the committed migrations still match
 * the pack. Without it, the migrations are rewritten from the pack.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PACK =
  'software-factory-pack/software-factory-pack/03_CONTRACTS_AND_DATA_MODEL.md';
const DEFAULT_OUT = join(REPO_ROOT, 'migrations');

const USAGE = `usage: tools/extract-pack-ddl [--check] [--out <dir>]`;

/**
 * The two SQL blocks in pack `03` §2, in order: the DDL, then the privileges.
 */
const packSqlBlocks = (markdown: string): readonly string[] => {
  const blocks: string[] = [];
  const fence = /```sql\n([\s\S]*?)```/g;
  let match = fence.exec(markdown);
  while (match !== null) {
    blocks.push(match[1] as string);
    match = fence.exec(markdown);
  }
  return blocks;
};

const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const check = argv.includes('--check');
  const outIndex = argv.indexOf('--out');
  const outDir =
    outIndex !== -1 && argv[outIndex + 1] !== undefined
      ? resolve(argv[outIndex + 1] as string)
      : DEFAULT_OUT;

  const packPath = join(REPO_ROOT, PACK);
  const markdown = readFileSync(packPath, 'utf8');
  const blocks = packSqlBlocks(markdown);

  if (blocks.length < 2) {
    console.error(`extract-pack-ddl: expected 2 sql blocks in ${PACK}, found ${blocks.length}`);
    process.exit(1);
  }

  const targets = [
    { file: '0001_core.sql', block: blocks[0] as string },
    { file: '0001_grants.sql', block: blocks[1] as string },
  ];

  if (check) {
    const problems: string[] = [];
    for (const target of targets) {
      let actual: string;
      try {
        actual = readFileSync(join(outDir, target.file), 'utf8');
      } catch {
        problems.push(`missing: migrations/${target.file}`);
        continue;
      }
      if (!actual.endsWith(target.block)) {
        problems.push(`drift: migrations/${target.file} no longer ends with the pack's sql block`);
      }
    }
    if (problems.length > 0) {
      for (const problem of problems) {
        console.error(`extract-pack-ddl: ${problem}`);
      }
      console.error('extract-pack-ddl: run `pnpm ddl:sync` to re-extract from the pack');
      process.exit(1);
    }
    console.log(`extract-pack-ddl: ${targets.length} migrations match pack 03 §2`);
    return;
  }

  for (const target of targets) {
    const path = join(outDir, target.file);
    const existing = readFileSync(path, 'utf8');
    // Preserve the provenance header (everything before the pack block) and
    // replace only the pack-derived body.
    const headerEnd = existing.indexOf('\n\n');
    const header = headerEnd === -1 ? '' : existing.slice(0, headerEnd + 2);
    writeFileSync(path, `${header}${target.block}`, 'utf8');
    console.log(`extract-pack-ddl: wrote migrations/${target.file} from the pack`);
  }
};

main();
