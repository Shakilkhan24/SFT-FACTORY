/**
 * `definition` — the capability registry.
 *
 * ## What this file does
 *
 * The definition's `ToolCapability` documents carry their schemas as
 * `{$ref: 'schemas/…'}`. The broker must not know where a schema came
 * from — it must receive a **resolved** schema.
 *
 * So this file resolves the refs and produces the broker's `RegistryEntry`
 * shape: the contracts' `ToolCapability` plus the resolved schemas and the
 * availability.
 *
 * ## Why the resolution fails closed
 *
 * A capability whose schema ref **cannot be resolved** is marked
 * `unavailable`, not silently accepted with no schema.
 *
 * The alternative is the dangerous one: a capability that declares
 * `inputSchema: {$ref: 'schemas/typo.schema.json'}` would, if the ref
 * resolution failed quietly, arrive at the broker with **no** input schema
 * — and a capability with no input schema accepts any arguments. So a
 * missing schema file would *widen* the capability rather than refuse it.
 *
 * The registry therefore refuses to resolve a ref it cannot find, and the
 * capability is unavailable.
 *
 * ## Why the `ToolCapability` is built here and not in the contracts
 *
 * The contracts' `ToolCapability` is the **runtime** shape: it carries the
 * schemas inline. The definition's `ToolCapabilityDefinition` is the
 * **document** shape: it carries the refs. Neither is derived from the
 * other automatically — the document is the source, and this file is where
 * the document becomes the runtime capability.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ToolCapability, ToolCapabilityDefinition } from '@factory/contracts';

import { DEFINITION_ROOT } from './loader.js';

/**
 * The registry entry, as the broker holds it.
 *
 * It is declared here rather than imported from `@factory/broker` because
 * `definition` must not depend on the broker — the dependency runs the
 * other way. The shape is the same, and the broker's own `RegistryEntry`
 * is structurally identical.
 */
export interface CapabilityRegistryEntry {
  /** The capability, exactly as the contracts describe it. */
  readonly capability: ToolCapability;
  /** The resolved `inputSchema`, when the capability declares one. */
  readonly inputSchema?: unknown;
  /** The resolved `outputSchema`, when the capability declares one. */
  readonly outputSchema?: unknown;
  /** Whether the capability is available. */
  readonly availability: 'available' | 'unavailable';
}

/**
 * A capability that could not be made available.
 */
export interface CapabilityProblem {
  readonly capabilityId: string;
  readonly reason: string;
}

/**
 * The outcome of building the registry.
 *
 * A capability that fails to resolve is **not** a failure of the whole
 * registry: one broken capability must not take the factory's entire tool
 * surface down. So the broken capability is reported and marked
 * unavailable, and the rest of the registry stands.
 */
export interface CapabilityRegistryLoad {
  readonly entries: readonly CapabilityRegistryEntry[];
  readonly problems: readonly CapabilityProblem[];
}

/**
 * The schema file's directory.
 *
 * A ref is `schemas/<path>.json`, relative to the **repository root** — the
 * same convention the contracts' `SchemaRef` uses. So the schemas live
 * beside the definition directory, not inside it.
 *
 * The path may name a **subdirectory** — the capabilities' own argument
 * schemas live in `schemas/capabilities/`, because `schemas/` itself is
 * the contracts' export directory. The resolver joins the remainder of the
 * ref onto this root, so a subdirectory needs no special handling — but
 * the `..` refusal below is what keeps the join inside the schemas tree.
 */
const schemasRoot = (definitionRoot: string): string =>
  resolve(definitionRoot, '..', 'schemas');

/**
 * Read and parse a JSON Schema file.
 */
const readSchema = async (path: string): Promise<unknown> => {
  const source = await readFile(path, 'utf8');
  return JSON.parse(source) as unknown;
};

/**
 * Build the runtime `ToolCapability` from a definition document.
 */
const capabilityOf = (document: ToolCapabilityDefinition): ToolCapability => {
  const spec = document.spec;
  return {
    id: document.metadata.name,
    version: document.metadata.version,
    owner: spec.owner,
    kind: spec.kind,
    transport: spec.transport,
    effect: {
      class: spec.effect.class,
      reversible: spec.effect.reversible,
      ...(spec.effect.undo === undefined ? {} : { undo: spec.effect.undo }),
      external: spec.effect.external,
    },
    scope: {
      required: [...spec.scope.required],
      resourcePattern: spec.scope.resourcePattern,
      environment: spec.scope.environment,
    },
    credentials: {
      provider: spec.credentials.provider,
      permissions: { ...spec.credentials.permissions },
      ttlSeconds: spec.credentials.ttlSeconds,
    },
    ...(spec.inputSchema === undefined ? {} : { inputSchema: spec.inputSchema }),
    ...(spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema }),
    trust: {
      inputTrust: spec.trust.inputTrust,
      resultTrust: spec.trust.resultTrust,
    },
    health: {
      check: spec.health.check,
      timeoutMs: spec.health.timeoutMs,
      degraded: spec.health.degraded,
    },
    observability: {
      redactArguments: [...spec.observability.redactArguments],
    },
    cost: {
      unit: spec.cost.unit,
      usdMicros: spec.cost.usdMicros,
    },
  };
};

/**
 * Resolve a schema ref.
 *
 * @returns the parsed schema, or the reason it could not be resolved.
 */
const resolveRef = async (
  ref: string,
  definitionRoot: string,
): Promise<{ readonly ok: true; readonly schema: unknown } | { readonly ok: false; readonly reason: string }> => {
  // The ref is `schemas/<path>.json`. A ref that escapes the schemas
  // directory is refused: a ref is a path into the repository's own
  // schema set, not an arbitrary path.
  if (!ref.startsWith('schemas/') || ref.includes('..')) {
    return {
      ok: false,
      reason: `the schema ref "${ref}" is not a path into the schemas directory`,
    };
  }

  try {
    const schema = await readSchema(resolve(schemasRoot(definitionRoot), ref.slice('schemas/'.length)));
    return { ok: true, schema };
  } catch (error) {
    return {
      ok: false,
      reason: `the schema "${ref}" could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/**
 * Build the capability registry from the definition's capability documents.
 *
 * @param documents the definition's `ToolCapability` documents.
 * @param definitionRoot the definition directory, used to locate the
 *   schemas directory.
 */
export const buildCapabilityRegistry = async (
  documents: readonly ToolCapabilityDefinition[],
  definitionRoot: string = DEFINITION_ROOT,
): Promise<CapabilityRegistryLoad> => {
  const entries: CapabilityRegistryEntry[] = [];
  const problems: CapabilityProblem[] = [];

  for (const document of documents) {
    const capabilityId = document.metadata.name;
    const capability = capabilityOf(document);

    const inputRef = document.spec.inputSchema?.$ref;
    const outputRef = document.spec.outputSchema?.$ref;

    let inputSchema: unknown;
    let outputSchema: unknown;

    if (inputRef !== undefined) {
      const resolved = await resolveRef(inputRef, definitionRoot);
      if (!resolved.ok) {
        // **Fail closed.** A capability whose input schema cannot be
        // resolved is unavailable — it is not downgraded to "no schema",
        // because a capability with no schema accepts any arguments.
        problems.push({ capabilityId, reason: resolved.reason });
        entries.push({ capability, availability: 'unavailable' });
        continue;
      }
      inputSchema = resolved.schema;
    }

    if (outputRef !== undefined) {
      const resolved = await resolveRef(outputRef, definitionRoot);
      if (!resolved.ok) {
        problems.push({ capabilityId, reason: resolved.reason });
        entries.push({ capability, availability: 'unavailable' });
        continue;
      }
      outputSchema = resolved.schema;
    }

    entries.push({
      capability,
      ...(inputSchema === undefined ? {} : { inputSchema }),
      ...(outputSchema === undefined ? {} : { outputSchema }),
      availability: 'available',
    });
  }

  return { entries, problems };
};
