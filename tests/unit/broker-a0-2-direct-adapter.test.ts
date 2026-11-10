/**
 * T-1.08 — **A0.2**: an adapter cannot be reached outside the broker.
 *
 * checklist 03's oracle for T-1.08: *"adapters constructible only inside
 * the broker module."*
 *
 * ## The two halves
 *
 * A **lint rule alone** is bypassable (`--no-verify`), and a **runtime
 * guard alone** is invisible in review. The ticket requires both, and they
 * are proved in two files:
 *
 * * **this file** — the runtime guard. `factory.ts` holds a module-private
 *   `unique symbol`, and an adapter's `invoke` requires it. A direct
 *   adapter call therefore **throws**.
 * * `broker-lint-rule.test.ts` — the lint rule, proved two-sided on a
 *   scratch tree.
 *
 * ## What this file proves that the lint rule cannot
 *
 * The lint rule says the *import* is forbidden. The runtime guard says the
 * *call* is impossible. So even a module that got past the lint rule — by
 * a rename, by a `require`, by `--no-verify` — cannot invoke a capability
 * without the broker.
 */

import { describe, expect, it } from 'vitest';

import {
  AdapterGuardError,
  CliAdapter,
  DefaultAdapterFactory,
  HttpAdapter,
  InprocAdapter,
  LibraryAdapter,
  McpAdapter,
  assertGuardToken,
  type AdapterCapability,
} from '../../packages/broker/src/index.ts';

/**
 * A capability, in the adapter's own shape.
 */
const CAPABILITY: AdapterCapability = {
  id: 'test.capability',
  transport: 'inproc',
  version: '1.0.0',
};

/**
 * A token that is **not** the factory's.
 */
const aForgedToken = (): symbol => Symbol('forged');

describe('T-1.08 · A0.2 — a direct adapter call fails', () => {
  it('refuses an in-process adapter invoked without the factory token', async () => {
    const adapter = new InprocAdapter(
      [CAPABILITY],
      new Map([['test.capability', () => Promise.resolve({ ok: true })]]),
    );

    await expect(
      adapter.invoke(
        'test.capability',
        {},
        undefined,
        new AbortController().signal,
        aForgedToken(),
      ),
    ).rejects.toBeInstanceOf(AdapterGuardError);
  });

  it('refuses an HTTP adapter invoked without the factory token', async () => {
    const adapter = new HttpAdapter(
      [{ ...CAPABILITY, transport: 'http', url: 'https://example.test/x' }],
      () => Promise.resolve({ status: 200, text: '{}' }),
    );

    await expect(
      adapter.invoke(
        'test.capability',
        {},
        undefined,
        new AbortController().signal,
        aForgedToken(),
      ),
    ).rejects.toBeInstanceOf(AdapterGuardError);
  });

  it('refuses a CLI adapter invoked without the factory token', async () => {
    const adapter = new CliAdapter(
      [{ ...CAPABILITY, transport: 'cli', program: 'git' }],
      () => Promise.resolve({ stdout: '{}', stderr: '', code: 0 }),
    );

    await expect(
      adapter.invoke(
        'test.capability',
        {},
        undefined,
        new AbortController().signal,
        aForgedToken(),
      ),
    ).rejects.toBeInstanceOf(AdapterGuardError);
  });

  it('refuses a library adapter invoked without the factory token', async () => {
    const adapter = new LibraryAdapter(
      [{ ...CAPABILITY, transport: 'library' }],
      new Map([['test.capability', () => Promise.resolve({ ok: true })]]),
    );

    await expect(
      adapter.invoke(
        'test.capability',
        {},
        undefined,
        new AbortController().signal,
        aForgedToken(),
      ),
    ).rejects.toBeInstanceOf(AdapterGuardError);
  });

  it('refuses an MCP adapter invoked without the factory token', async () => {
    const adapter = new McpAdapter(
      [{ ...CAPABILITY, transport: 'mcp', toolName: 'fixture.echo' }],
      {
        initialize: () =>
          Promise.resolve({
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'fixture', version: '0.1.0' },
          }),
        listTools: () => Promise.resolve({ tools: [] }),
        callTool: () => Promise.resolve({ content: [] }),
        close: () => Promise.resolve(undefined),
      },
    );

    await expect(
      adapter.invoke(
        'test.capability',
        {},
        undefined,
        new AbortController().signal,
        aForgedToken(),
      ),
    ).rejects.toBeInstanceOf(AdapterGuardError);
  });

  it('refuses a token that is merely equal-looking', () => {
    // `Symbol('factory.guard-token')` is a *different* symbol from the
    // factory's, even though it has the same description. The guard
    // compares by identity, not by description.
    expect(() => assertGuardToken(Symbol('factory.guard-token'))).toThrow(
      AdapterGuardError,
    );
  });

  it('accepts the token the factory hands out', async () => {
    const factory = new DefaultAdapterFactory({
      inproc: () =>
        new InprocAdapter(
          [CAPABILITY],
          new Map([['test.capability', () => Promise.resolve({ ok: true })]]),
        ),
      http: () => new HttpAdapter([], () => Promise.resolve({ status: 200, text: '{}' })),
      cli: () =>
        new CliAdapter([], () => Promise.resolve({ stdout: '{}', stderr: '', code: 0 })),
      mcp: () =>
        new McpAdapter([], {
          initialize: () =>
            Promise.resolve({
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'fixture', version: '0.1.0' },
            }),
          listTools: () => Promise.resolve({ tools: [] }),
          callTool: () => Promise.resolve({ content: [] }),
          close: () => Promise.resolve(undefined),
        }),
      library: () => new LibraryAdapter([], new Map()),
    });

    const adapter = await factory.adapterFor(CAPABILITY);
    const token = factory.guardToken();

    await expect(
      adapter.invoke(
        'test.capability',
        {},
        undefined,
        new AbortController().signal,
        token,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('never runs the handler when the token is refused', async () => {
    // The guard must fire **before** the handler, or a refused call would
    // still have had its side effect.
    let ran = false;
    const adapter = new InprocAdapter(
      [CAPABILITY],
      new Map([
        [
          'test.capability',
          () => {
            ran = true;
            return Promise.resolve({ ok: true });
          },
        ],
      ]),
    );

    await expect(
      adapter.invoke(
        'test.capability',
        {},
        undefined,
        new AbortController().signal,
        aForgedToken(),
      ),
    ).rejects.toBeInstanceOf(AdapterGuardError);

    expect(ran).toBe(false);
  });
});
