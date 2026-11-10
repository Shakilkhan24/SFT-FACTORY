/**
 * The capability registry (blueprint 11 §3.2).
 *
 * ## The rule this package exists to make true
 *
 * blueprint 11 §3.2: *"The registry's capability records are authoritative.
 * A tool the registry does not list **does not exist**, even if an MCP
 * server advertises it."*
 *
 * So the registry is a **closed set**. An MCP server that advertises a tool
 * the registry does not list has advertised something that does not exist:
 * it is reported as a finding, and it is **not** callable.
 *
 * The converse is also true, and is the other half of the rule: a
 * capability the registry *does* list, but which the transport no longer
 * advertises, is marked `unavailable`. It is not silently callable either —
 * the registry says it exists, but the transport cannot serve it, and
 * calling it would produce a confusing `tool.unavailable` at execution time
 * rather than at the gate.
 */

import type { ToolCapability } from '@factory/contracts';

import type { CapabilityRegistry } from './ports.js';
import type {
  ReconciliationFinding,
  ReconciliationReport,
  RegistryEntry,
} from './types.js';

/**
 * An in-memory capability registry.
 *
 * The registry holds the capability's *record* plus its **resolved**
 * schemas. The definition's form carries `{$ref: 'schemas/…'}` for its
 * schemas; the loader resolves those refs, so the registry — and everything
 * downstream of it — never has to know where a schema came from.
 */
export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  /** The registry's entries, by capability id. */
  readonly #entries = new Map<string, RegistryEntry>();

  /**
   * @param entries the registry's initial contents.
   */
  constructor(entries: readonly RegistryEntry[] = []) {
    for (const entry of entries) {
      this.#entries.set(entry.capability.id, entry);
    }
  }

  /**
   * The registry's entry for a capability.
   *
   * `undefined` means the capability **does not exist** — either it was
   * never registered, or it was marked unavailable by a reconciliation.
   */
  public lookup(capabilityId: string): RegistryEntry | undefined {
    const entry = this.#entries.get(capabilityId);
    if (entry === undefined) {
      return undefined;
    }
    // A capability the transport no longer advertises is *unavailable*, and
    // an unavailable capability must not be invoked — so `lookup` reports it
    // as absent, which is the same answer the broker needs.
    return entry.availability === 'available' ? entry : undefined;
  }

  /**
   * Every registered capability, available or not.
   *
   * The reconciliation needs the unavailable ones too — that is how it finds
   * the capabilities a transport stopped advertising.
   */
  public list(): readonly RegistryEntry[] {
    return [...this.#entries.values()];
  }

  /**
   * The registry's entries for a transport.
   */
  public listFor(transport: string): readonly RegistryEntry[] {
    return this.list().filter((entry) => entry.capability.transport === transport);
  }

  /**
   * Reconcile one transport's advertised capabilities against the registry.
   *
   * ## The two directions
   *
   * * `advertised-but-unregistered` — the transport offers it, the registry
   *   does not list it. It **does not exist**: not offered, not callable.
   * * `registered-but-not-advertised` — the registry lists it, the
   *   transport does not offer it. The capability is marked `unavailable`.
   *
   * Both directions are reported, because a registry that silently drops an
   * unregistered capability is indistinguishable from a registry that never
   * saw it. The *finding* is the evidence.
   */
  public reconcile(
    transport: string,
    advertised: readonly string[],
  ): ReconciliationReport {
    const advertisedSet = new Set(advertised);
    const findings: ReconciliationFinding[] = [];

    // Direction 1: advertised but not registered. These do not exist.
    for (const capabilityId of advertised) {
      if (!this.#entries.has(capabilityId)) {
        findings.push({
          capabilityId,
          kind: 'advertised-but-unregistered',
          transport,
        });
      }
    }

    // Direction 2: registered but not advertised. These become
    // unavailable.
    for (const entry of this.listFor(transport)) {
      if (!advertisedSet.has(entry.capability.id)) {
        findings.push({
          capabilityId: entry.capability.id,
          kind: 'registered-but-not-advertised',
          transport,
        });
        // Mark it unavailable. The entry is replaced, so the mark is
        // durable for the registry's lifetime.
        this.#entries.set(entry.capability.id, {
          ...entry,
          availability: 'unavailable',
        });
      }
    }

    return {
      transport,
      advertised: [...advertised],
      findings,
    };
  }

  /**
   * Add a capability to the registry.
   *
   * A capability added after a reconciliation is `available` — the
   * transport that advertised it is, by definition, serving it.
   */
  public register(
    capability: ToolCapability,
    schemas: { readonly inputSchema?: unknown; readonly outputSchema?: unknown } = {},
  ): void {
    this.#entries.set(capability.id, {
      capability,
      ...(schemas.inputSchema === undefined ? {} : { inputSchema: schemas.inputSchema }),
      ...(schemas.outputSchema === undefined ? {} : { outputSchema: schemas.outputSchema }),
      availability: 'available',
    });
  }
}

/**
 * The reconciliation's rule, as a pure function.
 *
 * The class above applies the rule; this is the rule itself, so it can be
 * reasoned about (and mutated) without a registry.
 */
export const reconcileAgainst = (
  registered: readonly RegistryEntry[],
  transport: string,
  advertised: readonly string[],
): ReconciliationReport => {
  const advertisedSet = new Set(advertised);
  const findings: ReconciliationFinding[] = [];

  for (const capabilityId of advertised) {
    if (!registered.some((entry) => entry.capability.id === capabilityId)) {
      findings.push({
        capabilityId,
        kind: 'advertised-but-unregistered',
        transport,
      });
    }
  }

  for (const entry of registered) {
    if (entry.capability.transport !== transport) {
      continue;
    }
    if (!advertisedSet.has(entry.capability.id)) {
      findings.push({
        capabilityId: entry.capability.id,
        kind: 'registered-but-not-advertised',
        transport,
      });
    }
  }

  return {
    transport,
    advertised: [...advertised],
    findings,
  };
};
