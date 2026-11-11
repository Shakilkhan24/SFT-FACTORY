/**
 * `contracts` — the **export documents**: the JSON Schema files that land in
 * `/schemas`.
 *
 * checklist 02 T-1.01: "Export JSON Schema to `/schemas`." The export is
 * deterministic — the same contracts produce byte-identical files — so the
 * directory can be committed and a diff in it is a real change to a
 * contract rather than noise.
 *
 * ## Why this is a module and not a script
 *
 * The export has **two** consumers, and they must agree byte for byte:
 *
 * 1. `tools/export-schemas.ts` — writes the files, and `--check` compares
 *    them against what the contracts would produce;
 * 2. `factory doctor`'s `schemas` check — compares the committed files
 *    against what the contracts would produce.
 *
 * If each of them built the document itself, they would drift: a change to
 * the `title` or the `description` would make the exporter write one shape
 * and the doctor compare against another, and the doctor's failure would be
 * a lie — it would report the export as stale when it was not.
 *
 * So the document is built **here**, once, and both consumers use it. This
 * module is pure — no I/O, no filesystem — because `contracts` may not do
 * I/O (pack 02 §3: "contracts imports nothing internal").
 */

import { toJsonSchema, type JsonSchema } from './json-schema.js';
import { CONTRACTS, type ContractEntry } from './schema-registry.js';

/**
 * One exported document: its file name and its bytes.
 */
export interface ExportDocument {
  /** The file name under `/schemas`, without the extension. */
  readonly name: string;
  /** The document's exact contents, including the trailing newline. */
  readonly content: string;
}

/**
 * Build the export document for one contract.
 *
 * The shape is the one `tools/export-schemas.ts` has always written:
 * the JSON Schema with the contract's `title` and a `description` that
 * names the pack section it came from — so a reader of `/schemas` can
 * trace a document back to its specification.
 */
export const exportDocument = (entry: ContractEntry): ExportDocument => {
  const schema = toJsonSchema(entry.schema, { name: `${entry.name}.json` });
  const document: JsonSchema = {
    $schema: schema['$schema'],
    $id: schema['$id'],
    title: entry.name,
    description: `Contract from pack ${entry.source}.`,
    ...schema,
  };

  // Drop the undefined members the spread may have introduced — an
  // `undefined` value would serialise as `null` in `JSON.stringify` only
  // for `undefined` array members, but as a **dropped** key for object
  // members. Being explicit keeps the output deterministic.
  for (const key of Object.keys(document)) {
    if (document[key] === undefined) {
      delete document[key];
    }
  }

  return {
    name: `${entry.name}.json`,
    content: `${JSON.stringify(document, null, 2)}\n`,
  };
};

/**
 * Every exported document, in registry order.
 *
 * The registry is **explicit** (see `schema-registry.ts`), so this list is
 * exactly the contracts the package exports — no more, no fewer.
 */
export const exportDocuments = (): readonly ExportDocument[] =>
  CONTRACTS.map(exportDocument);
