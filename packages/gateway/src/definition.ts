/**
 * `gateway` — loading the definition's gateway documents.
 *
 * ## Two files, two shapes
 *
 * `definition/routing-policy.yaml` is a **definition document** — its
 * `kind` is `RoutingPolicy`, which is in the contracts'
 * `DEFINITION_KINDS`, so the definition store validates it and it
 * travels in the definition bundle.
 *
 * `definition/pricing.yaml` is **not** a definition document. Its kind
 * is `PricingTable`, which is *not* in `DEFINITION_KINDS` — and
 * HR-12 / AGENTS.md §5 freeze the contracts, so this ticket cannot add
 * a kind. The pricing table is therefore a **separate file** the
 * gateway loads directly.
 *
 * That is not a workaround; it is what the corpus says. pack 04 §6:
 * *"**Pricing** lives in `definition/pricing.yaml` (per-model USD per
 * million tokens, per token class) — **never hard-coded**."* It says
 * the file lives in `definition/`. It does not say it is a definition
 * document, and the contracts' kind list says it is not.
 *
 * ## The prices are integers
 *
 * The price is quoted in **micro-USD per million tokens** as an
 * integer, so the whole cost computation is integer arithmetic
 * (pack 04 §6: "Costs are integer micro-USD").
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import yaml from 'js-yaml';

import { RoutingPolicy } from '@factory/contracts';

import type { PriceEntry, PricingTable } from './types.js';

/**
 * The repository's `definition/` directory.
 *
 * Resolved from this file's location — `packages/gateway/src` — so the
 * loader works regardless of the process's working directory.
 */
export const DEFINITION_ROOT = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'definition',
);

/**
 * A pricing document's shape.
 *
 * The kind is checked on the way in, so a file that is not a pricing
 * table is refused rather than misread.
 */
interface PricingDocument {
  readonly apiVersion?: string;
  readonly kind?: string;
  readonly spec?: {
    readonly models?: Readonly<Record<string, unknown>>;
  };
}

/**
 * The kind a pricing document must declare.
 */
export const PRICING_KIND = 'PricingTable';

/**
 * Parse a routing policy document.
 *
 * @param source the YAML text.
 * @throws {ZodError} when the document is not a valid routing policy.
 */
export const parseRoutingPolicy = (source: string): RoutingPolicy =>
  RoutingPolicy.parse(yaml.load(source));

/**
 * Read `definition/routing-policy.yaml`.
 *
 * @param root the definition directory. Defaults to the repository's.
 */
export const readRoutingPolicy = async (
  root: string = DEFINITION_ROOT,
): Promise<RoutingPolicy> => {
  const source = await readFile(resolve(root, 'routing-policy.yaml'), 'utf8');
  return parseRoutingPolicy(source);
};

/**
 * Parse a pricing table document.
 *
 * @param source the YAML text.
 * @throws {Error} when the document is not a pricing table, or a price
 * is not a non-negative integer.
 */
export const parsePricingTable = (source: string): PricingTable => {
  const document = yaml.load(source) as PricingDocument | undefined;

  if (document === undefined || document === null) {
    throw new Error('the pricing document is empty');
  }

  if (document.kind !== PRICING_KIND) {
    throw new Error(
      `the pricing document must declare the kind "${PRICING_KIND}" (got ${String(document.kind)})`,
    );
  }

  const models = document.spec?.models;

  if (models === undefined || models === null) {
    throw new Error('the pricing document declares no models');
  }

  const table: Record<string, PriceEntry> = {};

  for (const [model, raw] of Object.entries(models)) {
    table[model] = priceEntryOf(model, raw);
  }

  return table;
};

/**
 * Read one model's price.
 *
 * Every field must be a **non-negative integer**. A float would make
 * the cost computation a float computation, and a negative price would
 * make a cost negative — which would *increase* the remaining budget.
 */
const priceEntryOf = (model: string, raw: unknown): PriceEntry => {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`the price for the model "${model}" is not a record`);
  }

  const record = raw as Record<string, unknown>;

  const read = (field: string): number => {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(
        `the price for the model "${model}" has a "${field}" that is not a non-negative integer`,
      );
    }
    return value;
  };

  return {
    inputPerMillionUsdMicros: read('inputPerMillionUsdMicros'),
    outputPerMillionUsdMicros: read('outputPerMillionUsdMicros'),
    cacheReadPerMillionUsdMicros: read('cacheReadPerMillionUsdMicros'),
    cacheWritePerMillionUsdMicros: read('cacheWritePerMillionUsdMicros'),
  };
};

/**
 * Read `definition/pricing.yaml`.
 *
 * @param root the definition directory. Defaults to the repository's.
 */
export const readPricingTable = async (
  root: string = DEFINITION_ROOT,
): Promise<PricingTable> => {
  const source = await readFile(resolve(root, 'pricing.yaml'), 'utf8');
  return parsePricingTable(source);
};
