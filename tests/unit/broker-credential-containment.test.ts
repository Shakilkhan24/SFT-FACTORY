/**
 * T-1.08 — the **credential containment**.
 *
 * blueprint 11 §6.5: *"the credential's reference and scopes are recorded
 * but its material never is."*
 *
 * ## What the rule protects
 *
 * The credential's **material** — the secret itself — is held for the
 * duration of **one** invocation and is never written anywhere: not into
 * the arguments, not into the result, not into the invocation record, not
 * into the event.
 *
 * The **reference** — the credential's id, its scopes and its expiry — *is*
 * recorded, because the audit trail needs to be able to say which
 * credential was used.
 *
 * ## Why "never in the result" is the sharp edge
 *
 * A capability that echoes its arguments back would carry the credential
 * out with the result — and the result is what the broker validates,
 * records and hands to the agent. So the broker **strips** the injected
 * credential from the result before the result leaves the adapter.
 *
 * The library adapter is where the injection happens (the credential goes
 * *into* the arguments under a reserved key), so it is where the strip
 * happens too.
 */

import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_ARGUMENT_KEY,
  LibraryAdapter,
  type InvocationRequest,
} from '../../packages/broker/src/index.ts';
import {
  aContext,
  aGrant,
  buildBroker as buildTheBroker,
  type BrokerHarnessOptions,
} from '../helpers/broker.ts';

/**
 * The secret the credential provider hands out.
 */
const SECRET = 'ghp_thisIsTheSecretMaterial';

const buildBroker = (
  options: {
    readonly handler?: (
      args: unknown,
      credential: unknown,
    ) => unknown;
  } & Omit<BrokerHarnessOptions, 'handler'> = {},
) =>
  buildTheBroker({
    secret: SECRET,
    ...options,
    ...(options.handler === undefined
      ? {}
      : { handler: (args, credential) => options.handler?.(args, credential) }),
  });

/**
 * A request.
 */
const aRequest = (overrides: Partial<InvocationRequest> = {}): InvocationRequest => ({
  capabilityId: 'test.capability',
  args: {},
  context: aContext(),
  grant: aGrant(),
  ...overrides,
});

describe('T-1.08 — the credential containment', () => {
  describe('the invocation record', () => {
    it('carries the credential’s REFERENCE, not its material', async () => {
      const { broker, store } = buildBroker();

      await broker.invoke(aRequest());

      const record = store.records()[0];
      expect(record?.credential?.credId).toBe('cred_test');
      expect(record?.credential?.scopes).toEqual(['repository']);
      expect(record?.credential?.expiresAt).toBe('2026-11-10T00:00:00.000Z');
    });

    it('does NOT carry the secret anywhere in the record', async () => {
      const { broker, store } = buildBroker();

      await broker.invoke(aRequest());

      expect(JSON.stringify(store.records()[0])).not.toContain(SECRET);
    });

    it('does NOT carry the secret in the event', async () => {
      const { broker, store } = buildBroker();

      await broker.invoke(aRequest());

      expect(JSON.stringify(store.events()[0])).not.toContain(SECRET);
    });

    it('does NOT carry the secret in the arguments summary', async () => {
      const { broker, store } = buildBroker({
        handler: () => ({ ok: true }),
      });

      await broker.invoke(aRequest({ args: { note: 'harmless' } }));

      expect(JSON.stringify(store.records()[0]?.argsSummary)).not.toContain(SECRET);
    });

    it('the credential IS acquired, exactly once', async () => {
      const { broker, credentials } = buildBroker();

      await broker.invoke(aRequest());

      expect(credentials.calls).toHaveLength(1);
      expect(credentials.calls[0]?.capabilityId).toBe('test.capability');
    });
  });

  describe('the arguments', () => {
    it('the secret is NOT injected into the arguments by the broker', async () => {
      // The broker hands the credential to the adapter as its **own**
      // parameter. It does not fold it into the caller's arguments — that
      // would put the secret into the arguments summary, which is
      // recorded.
      const { broker, invoked: seen } = buildBroker();

      await broker.invoke(aRequest({ args: { repo: 'org/repo' } }));

      expect(JSON.stringify(seen[0]?.args)).not.toContain(SECRET);
      expect(seen[0]?.credential).toBeDefined();
    });

    it('the adapter receives the credential as its own parameter', async () => {
      const { broker, invoked: seen } = buildBroker();

      await broker.invoke(aRequest());

      const credential = seen[0]?.credential as { secret?: string } | undefined;
      expect(credential?.secret).toBe(SECRET);
    });
  });

  describe('the result', () => {
    it('a result that echoes the secret does NOT carry it out', async () => {
      // A capability that echoes its input would carry the credential out
      // with the result — and the result is validated, recorded and handed
      // to the agent.
      const { broker } = buildBroker({
        handler: (_args, credential) => ({
          echoed: (credential as { secret: string }).secret,
        }),
      });

      const outcome = await broker.invoke(aRequest());

      expect(outcome.ok).toBe(true);
      expect(JSON.stringify(outcome.ok ? outcome.value : null)).not.toContain(SECRET);
    });

    it('the recorded result summary does NOT carry the secret', async () => {
      const { broker, store } = buildBroker({
        handler: (_args, credential) => ({
          echoed: (credential as { secret: string }).secret,
        }),
      });

      await broker.invoke(aRequest());

      expect(JSON.stringify(store.records()[0]?.resultSummary)).not.toContain(SECRET);
    });
  });

  describe('the library adapter', () => {
    it('injects the credential under the reserved key', async () => {
      let seen: unknown;
      const adapter = new LibraryAdapter(
        [
          {
            id: 'test.capability',
            version: '1.0.0',
            transport: 'library',
          },
        ],
        new Map([
          [
            'test.capability',
            (args: unknown) => {
              seen = args;
              return Promise.resolve({ ok: true });
            },
          ],
        ]),
      );

      const factory = new (
        await import('../../packages/broker/src/index.ts')).DefaultAdapterFactory({
          inproc: () => adapter,
          http: () => adapter,
          cli: () => adapter,
          mcp: () => adapter,
          library: () => adapter,
        });

      await adapter.invoke(
        'test.capability',
        { repo: 'org/repo' },
        { secret: SECRET },
        new AbortController().signal,
        factory.guardToken(),
      );

      const args = seen as Record<string, unknown>;
      expect(args[CREDENTIAL_ARGUMENT_KEY]).toEqual({ secret: SECRET });
    });

    it('strips the credential from the result', async () => {
      const adapter = new LibraryAdapter(
        [
          {
            id: 'test.capability',
            version: '1.0.0',
            transport: 'library',
          },
        ],
        new Map([
          [
            'test.capability',
            (args: unknown) => Promise.resolve(args),
          ],
        ]),
      );

      const { DefaultAdapterFactory } = await import(
        '../../packages/broker/src/index.ts'
      );
      const factory = new DefaultAdapterFactory({
        inproc: () => adapter,
        http: () => adapter,
        cli: () => adapter,
        mcp: () => adapter,
        library: () => adapter,
      });

      const result = await adapter.invoke(
        'test.capability',
        { repo: 'org/repo' },
        { secret: SECRET },
        new AbortController().signal,
        factory.guardToken(),
      );

      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain(CREDENTIAL_ARGUMENT_KEY);
    });
  });
});
