/**
 * T-1.08 — the **MCP reconciliation**.
 *
 * blueprint 11 §3.2: *"The registry's capability records are authoritative.
 * A tool the registry does not list **does not exist**, even if an MCP
 * server advertises it."*
 *
 * pack 04 §12 states the same rule as a contract test:
 *
 * > (a) a registered MCP tool is callable exactly like any other
 * > capability (FR-62); (b) a tool advertised by a server but absent from
 * > the registry **does not exist** (reconciliation); (c) MCP results are
 * > tagged by the capability's declared trust.
 *
 * ## The rule in both directions
 *
 * The rule has two halves, and a test that only proves one of them proves
 * something weaker than the rule:
 *
 * * **Advertised but not registered ⇒ does not exist.** The server offers
 *   it; the registry does not list it; so it is not callable, and the
 *   finding is reported.
 * * **Registered but not advertised ⇒ unavailable.** The registry lists
 *   it; the server stopped offering it; so it is not callable either, and
 *   the finding is reported.
 *
 * The second half matters as much as the first. Without it, a registry
 * would offer a capability that the transport cannot serve, and the
 * failure would surface as a confusing `tool.unavailable` at execution
 * time rather than at the gate.
 *
 * ## Why the fixture advertises two tools
 *
 * The fixture server advertises `fixture.echo` (registered) and
 * `fixture.unregistered` (not registered). A fixture that advertised only
 * registered tools could not demonstrate the rule that matters.
 */

import { describe, expect, it } from 'vitest';

import {
  AdapterGuardError,
  DefaultAdapterFactory,
  FixtureMcpServer,
  InMemoryCapabilityRegistry,
  InProcessMcpClient,
  McpAdapter,
  reconcileAgainst,
  type FixtureTool,
} from '../../packages/broker/src/index.ts';
import { aCapability, anEntry } from '../helpers/broker.ts';

/**
 * The fixture tools.
 */
const fixtureTools = (): readonly FixtureTool[] => [
  {
    name: 'fixture.echo',
    description: 'echoes its arguments',
    inputSchema: { type: 'object' },
    call: (args: unknown) => ({ echoed: args }),
  },
  {
    name: 'fixture.unregistered',
    description: 'advertised but never registered',
    inputSchema: { type: 'object' },
    call: (args: unknown) => ({ echoed: args }),
  },
];

/**
 * A registry holding only `fixture.echo`.
 */
const aRegistry = (): InMemoryCapabilityRegistry =>
  new InMemoryCapabilityRegistry([
    anEntry(
      aCapability({
        id: 'fixture.echo',
        transport: 'mcp',
        kind: 'read',
        effect: { class: 'E0', reversible: true, external: false },
      }),
    ),
  ]);

describe('T-1.08 — the MCP reconciliation', () => {
  describe('direction 1: advertised but not registered', () => {
    it('reports the advertised-but-unregistered tool as a finding', () => {
      const registry = aRegistry();

      const report = registry.reconcile('mcp', ['fixture.echo', 'fixture.unregistered']);

      expect(report.findings).toEqual([
        {
          capabilityId: 'fixture.unregistered',
          kind: 'advertised-but-unregistered',
          transport: 'mcp',
        },
      ]);
    });

    it('the advertised-but-unregistered tool does not exist', () => {
      const registry = aRegistry();
      registry.reconcile('mcp', ['fixture.echo', 'fixture.unregistered']);

      expect(registry.lookup('fixture.unregistered')).toBeUndefined();
    });

    it('the registered tool is untouched by the reconciliation', () => {
      const registry = aRegistry();
      registry.reconcile('mcp', ['fixture.echo', 'fixture.unregistered']);

      expect(registry.lookup('fixture.echo')).toBeDefined();
    });

    it('the pure rule agrees with the registry', () => {
      const registry = aRegistry();

      const report = reconcileAgainst(
        registry.list(),
        'mcp',
        ['fixture.echo', 'fixture.unregistered'],
      );

      expect(report.findings.map((finding) => finding.capabilityId)).toEqual([
        'fixture.unregistered',
      ]);
    });
  });

  describe('direction 2: registered but not advertised', () => {
    it('reports the registered-but-not-advertised capability as a finding', () => {
      const registry = aRegistry();

      const report = registry.reconcile('mcp', []);

      expect(report.findings).toEqual([
        {
          capabilityId: 'fixture.echo',
          kind: 'registered-but-not-advertised',
          transport: 'mcp',
        },
      ]);
    });

    it('the registered-but-not-advertised capability becomes unavailable', () => {
      const registry = aRegistry();
      registry.reconcile('mcp', []);

      // `lookup` reports an unavailable capability as absent — the broker
      // must not invoke it.
      expect(registry.lookup('fixture.echo')).toBeUndefined();
    });

    it('the entry is still listed, so the finding can be acted on', () => {
      // The capability is not *deleted* — the reconciliation is a
      // **report**, and an operator has to be able to see what changed.
      const registry = aRegistry();
      registry.reconcile('mcp', []);

      expect(registry.list()).toHaveLength(1);
      expect(registry.list()[0]?.availability).toBe('unavailable');
    });
  });

  describe('the reconciliation is scoped to one transport', () => {
    it('does not mark a capability of another transport unavailable', () => {
      const registry = new InMemoryCapabilityRegistry([
        anEntry(
          aCapability({
            id: 'other.transport',
            transport: 'http',
          }),
        ),
      ]);

      const report = registry.reconcile('mcp', []);

      expect(report.findings).toEqual([]);
      expect(registry.lookup('other.transport')).toBeDefined();
    });
  });

  describe('the MCP adapter', () => {
    it('calls a registered tool through the client', async () => {
      const server = new FixtureMcpServer(fixtureTools());
      const client = new InProcessMcpClient(server);
      const adapter = new McpAdapter(
        [
          {
            id: 'fixture.echo',
            version: '1.0.0',
            transport: 'mcp',
            toolName: 'fixture.echo',
          },
        ],
        client,
      );

      // The guard token is obtainable **only** from the factory — that is
      // the whole of A0.2's runtime half. The factory is imported here
      // because the test is inside the broker module's own package tree.
      const factory = new DefaultAdapterFactory({
        inproc: () => adapter,
        http: () => adapter,
        cli: () => adapter,
        mcp: () => adapter,
        library: () => adapter,
      });

      const value = await adapter.invoke(
        'fixture.echo',
        { hello: 'world' },
        undefined,
        new AbortController().signal,
        factory.guardToken(),
      );

      expect(value).toEqual({ echoed: { hello: 'world' } });
    });

    it('refuses a call whose token the factory did not issue', async () => {
      const server = new FixtureMcpServer(fixtureTools());
      const client = new InProcessMcpClient(server);
      const adapter = new McpAdapter(
        [
          {
            id: 'fixture.echo',
            version: '1.0.0',
            transport: 'mcp',
            toolName: 'fixture.echo',
          },
        ],
        client,
      );

      await expect(
        adapter.invoke(
          'fixture.echo',
          { hello: 'world' },
          undefined,
          new AbortController().signal,
          Symbol('forged'),
        ),
      ).rejects.toThrow(AdapterGuardError);
    });

    it('the fixture server advertises both tools', async () => {
      const server = new FixtureMcpServer(fixtureTools());
      const client = new InProcessMcpClient(server);

      await client.initialize();
      const listing = await client.listTools();

      expect(listing.tools.map((tool) => tool.name)).toEqual([
        'fixture.echo',
        'fixture.unregistered',
      ]);
    });

    it('the client reaches the fixture server over JSON-RPC', async () => {
      const server = new FixtureMcpServer(fixtureTools());
      const client = new InProcessMcpClient(server);

      const result = await client.callTool('fixture.echo', { a: 1 });

      expect(result.structuredContent).toEqual({ echoed: { a: 1 } });
    });

    it('the client reports a tool the server does not serve as an error', async () => {
      const server = new FixtureMcpServer(fixtureTools());
      const client = new InProcessMcpClient(server);

      await expect(client.callTool('fixture.absent', {})).rejects.toThrow(
        /does not serve/,
      );
    });
  });
});
