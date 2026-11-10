/**
 * T-1.08 — **A0.1**: a call outside the grant is denied.
 *
 * checklist 03's oracle for T-1.08: *"A tool the registry doesn't list does
 * not exist, even if an MCP server advertises it"* and *"a call outside the
 * grant is denied."*
 *
 * ## The three refusals this file proves
 *
 * 1. **The capability is not in the grant** → denied at step 3.
 * 2. **The grant does not allow the required scope** → denied at step 3.
 * 3. **The capability is on the grant's deny list** → denied at step 2,
 *    *before* the grant check, because a deny is terminal regardless of
 *    what any grant says.
 *
 * And each denial is recorded: a refused call is evidence.
 */

import { describe, expect, it } from 'vitest';

import { aGrant, aRequest, buildBroker } from '../helpers/broker.ts';

describe('T-1.08 · A0.1 — a call outside the grant', () => {
  it('denies a call the grant does not name', async () => {
    const { broker, credentials } = buildBroker();

    const outcome = await broker.invoke(
      aRequest({ grant: aGrant({ capabilities: ['some.other.capability'] }) }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('grant');
    expect(outcome.ok === false && outcome.failureClass).toBe('policy.denied');
    expect(outcome.ok === false && outcome.reason).toContain('does not name the capability');

    // No credential was consumed for a call that was refused.
    expect(credentials.calls).toEqual([]);
  });

  it('denies a call the grant does not cover the scope of', async () => {
    const { broker, credentials } = buildBroker();

    const outcome = await broker.invoke(
      aRequest({ grant: aGrant({ scopes: ['repo:write'] }) }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('grant');
    expect(outcome.ok === false && outcome.reason).toContain('does not allow the scope');
    expect(credentials.calls).toEqual([]);
  });

  it('denies a call on the grant deny list, before the grant check', async () => {
    const { broker, credentials } = buildBroker();

    // The grant also *names* the capability — so the grant check would
    // have passed. The deny list is what refuses it.
    const outcome = await broker.invoke(
      aRequest({ grant: aGrant({ deny: ['test.capability'] }) }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('deny-list');
    expect(outcome.ok === false && outcome.failureClass).toBe('policy.denied');
    expect(outcome.ok === false && outcome.ruleIds).toEqual([
      'grant.deny/test.capability',
    ]);
    expect(credentials.calls).toEqual([]);
  });

  it('denies a call whose required scope is on the grant deny list', async () => {
    const { broker } = buildBroker();

    const outcome = await broker.invoke(
      aRequest({ grant: aGrant({ deny: ['repo:read'] }) }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('deny-list');
    expect(outcome.ok === false && outcome.ruleIds).toEqual([
      'grant.deny/repo:read',
    ]);
  });

  it('allows a call the grant covers', async () => {
    const { broker } = buildBroker();

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);
  });

  it('denies a call whose resource is another repository', async () => {
    // blueprint 11 §4.3: "Resource scope is the one that catches the
    // interesting bug. A worker with `repo:write` on `org/repo` that is
    // handed an artefact referencing `org/other-repo` must be refused on
    // the *resource*, not the capability."
    const { broker } = buildBroker();

    const outcome = await broker.invoke(
      aRequest({
        resource: { repo: 'org/other-repo' },
        grant: aGrant({ repo: 'org/repo' }),
      }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('resource-scope');
    expect(outcome.ok === false && outcome.reason).toContain('org/other-repo');
  });

  it('denies a call whose path is outside the grant write scope', async () => {
    const { broker } = buildBroker();

    const outcome = await broker.invoke(
      aRequest({
        resource: { repo: 'org/repo', paths: ['migrations/001.sql'] },
        grant: aGrant({ repo: 'org/repo', writeGlobs: ['src/**'] }),
      }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('resource-scope');
    expect(outcome.ok === false && outcome.reason).toContain('migrations/001.sql');
  });

  it('denies a call whose path is on the grant deny list', async () => {
    const { broker } = buildBroker();

    const outcome = await broker.invoke(
      aRequest({
        resource: { repo: 'org/repo', paths: ['.github/workflows/ci.yml'] },
        grant: aGrant({ repo: 'org/repo', denyGlobs: ['.github/**'] }),
      }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('resource-scope');
    expect(outcome.ok === false && outcome.reason).toContain('deny list');
  });

  it('allows a call whose path is inside the grant write scope', async () => {
    const { broker } = buildBroker();

    const outcome = await broker.invoke(
      aRequest({
        resource: { repo: 'org/repo', paths: ['src/index.ts'] },
        grant: aGrant({ repo: 'org/repo', writeGlobs: ['src/**'] }),
      }),
    );

    expect(outcome.ok).toBe(true);
  });
});
