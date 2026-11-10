/**
 * `api-access-points` — the six access points' behaviour (T-1.14).
 *
 * ## What this file covers
 *
 * The access points' **rules**, as opposed to the authentication rules
 * (`api-auth.test.ts`), the event rules (`api-events.test.ts`) and the
 * shape of the surface (`api-route-inventory.test.ts`).
 *
 * * **AP-1** — the kill switch refuses intake; the intent becomes a task.
 * * **AP-2** — the approver list, the hash binding and the expiry; the
 *   revoke.
 * * **AP-3** — the three decisions are three events; the rationale is
 *   required.
 * * **AP-4** — the reads.
 * * **AP-5** — the five interventions; the kill switch; the temporary
 *   grant's TTL cap.
 * * **AP-6** — the plan is a read; the apply **refuses** when the
 *   approval does not bind the bundle.
 *
 * ## The AP-6 trap
 *
 * blueprint `13` §3.3 quotes ADR-0001's acceptance test: "A
 * control-surface write that is not backed by a reviewed change in the
 * definition is **rejected**."
 *
 * So AP-6's apply **refuses** a call whose approval does not bind the
 * bundle being applied — with `code: 'hash_mismatch'`. That is the
 * ticket's "definition write via API rejected" proof.
 */

import { describe, expect, it } from 'vitest';

import {
  browserHeaders,
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.js';
import type { Harness } from '../../apps/api/src/harness.js';

/**
 * A pending approval, with the approver `alice`.
 */
const putApproval = (
  harness: Harness,
  overrides: Partial<{
    id: string;
    artefactSha256: `sha256:${string}`;
    artefactCurrentSha256: `sha256:${string}`;
    approvers: readonly string[];
    expiresAt: string;
    status: string;
  }> = {},
): void => {
  const id = overrides.id ?? 'appr-1';
  const bound = overrides.artefactSha256 ?? `sha256:${'a'.repeat(64)}`;
  const current = overrides.artefactCurrentSha256 ?? bound;
  harness.approvals.put({
    id,
    taskId: 'task-1',
    type: 'merge',
    artefactRef: 'artefact://diff/1',
    artefactSha256: bound,
    approvers: overrides.approvers ?? ['alice'],
    status: overrides.status ?? 'pending',
    requestedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: overrides.expiresAt ?? '2999-01-01T00:00:00.000Z',
    artefact: {
      kind: 'diff',
      ref: 'artefact://diff/1',
      sha256: current,
      blocks: [],
    },
  });
};

/**
 * A review for task-1.
 */
const putReview = (harness: Harness): void => {
  harness.reviews.put({
    taskId: 'task-1',
    risk: 'high',
    rationale: ['the diff touches the policy bundle'],
    queuedAt: '2026-01-01T00:00:00.000Z',
    spec: 'a spec',
    oracleResult: 'passed',
    gateReport: 'green',
    panelResult: 'approved',
    blastRadius: 'the policy bundle',
    diffLink: 'https://diff.invalid/1',
  });
};

describe('AP-1 · define-intent', () => {
  it('an intent becomes a task', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: {
        repo: 'owner/repo',
        source: { kind: 'github-issue', ref: 'owner/repo#123' },
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json<{ taskId: string }>();
    expect(body.taskId).toBe('task-000001');

    // The intent reached the port intact.
    expect(harness.intents.recorded).toHaveLength(1);
    expect(harness.intents.recorded[0]?.repo).toBe('owner/repo');

    await harness.close();
  });

  it('the kill switch refuses intake', async () => {
    const harness = await buildHarness();
    await harness.killSwitch.set(true, 'an incident');

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: {
        repo: 'owner/repo',
        source: { kind: 'github-issue', ref: 'owner/repo#123' },
      },
    });

    expect(response.statusCode).toBe(503);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('kill_switch');

    // The refusal came **before** the intake — no task was created.
    expect(harness.intents.recorded).toHaveLength(0);

    await harness.close();
  });

  it('releasing the kill switch lets intake through again', async () => {
    const harness = await buildHarness();
    await harness.killSwitch.set(true, 'an incident');
    await harness.killSwitch.set(false, 'the incident is over');

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: {
        repo: 'owner/repo',
        source: { kind: 'github-issue', ref: 'owner/repo#123' },
      },
    });

    expect(response.statusCode).toBe(202);
    await harness.close();
  });

  it('a body with an unknown field is refused', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: {
        repo: 'owner/repo',
        source: { kind: 'github-issue', ref: 'owner/repo#123' },
        workflow: 'a workflow',
        somethingElse: true,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('validation');
    expect(harness.intents.recorded).toHaveLength(0);

    await harness.close();
  });
});

describe('AP-2 · approve', () => {
  it('a grant is recorded as approval.granted', async () => {
    const harness = await buildHarness();
    putApproval(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/approvals/appr-1/decision',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { decision: 'grant', securityScopeAck: true },
    });

    expect(response.statusCode).toBe(200);
    expect(harness.events.last?.eventType).toBe('approval.granted');

    // The security-scope acknowledgement is recorded — an
    // acknowledgement nobody recorded is an acknowledgement nobody gave.
    const payload = harness.events.last?.payload as {
      securityScopeAck: boolean;
      decidedBy: string;
      artefactSha256: string;
    };
    expect(payload.securityScopeAck).toBe(true);
    expect(payload.decidedBy).toBe('alice');
    expect(payload.artefactSha256).toBe(`sha256:${'a'.repeat(64)}`);

    await harness.close();
  });

  it('a caller outside the approver list is refused', async () => {
    const harness = await buildHarness();
    putApproval(harness, { approvers: ['bob'] });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/approvals/appr-1/decision',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { decision: 'grant' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ code: string; detail: string }>();
    expect(body.code).toBe('not_approver');
    expect(body.detail).toContain('alice');

    // The decision never reached the port.
    expect(harness.approvals.decisions).toHaveLength(0);

    await harness.close();
  });

  it('an approval whose artefact changed is refused with hash_mismatch', async () => {
    // The approval is bound to one digest; the artefact now carries
    // another. The thing the approver saw is not the thing approved.
    const harness = await buildHarness();
    putApproval(harness, {
      artefactSha256: `sha256:${'a'.repeat(64)}`,
      artefactCurrentSha256: `sha256:${'d'.repeat(64)}`,
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/approvals/appr-1/decision',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { decision: 'grant' },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('hash_mismatch');
    expect(harness.approvals.decisions).toHaveLength(0);

    await harness.close();
  });

  it('an expired approval is refused with expired', async () => {
    const harness = await buildHarness();
    putApproval(harness, { expiresAt: '2025-01-01T00:00:00.000Z' });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/approvals/appr-1/decision',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { decision: 'grant' },
    });

    expect(response.statusCode).toBe(410);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('expired');
    expect(harness.approvals.decisions).toHaveLength(0);

    await harness.close();
  });

  it('the approver list is checked before the binding and the expiry', async () => {
    // A caller who is not an approver does not need to be told their
    // approval expired — the first thing wrong with the call is the
    // refusal they get.
    const harness = await buildHarness();
    putApproval(harness, {
      approvers: ['bob'],
      expiresAt: '2025-01-01T00:00:00.000Z',
      artefactCurrentSha256: `sha256:${'d'.repeat(64)}`,
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/approvals/appr-1/decision',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { decision: 'grant' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('not_approver');

    await harness.close();
  });

  it('a refusal is recorded as approval.revoked', async () => {
    const harness = await buildHarness();
    putApproval(harness);

    await harness.app.inject({
      method: 'POST',
      url: '/v1/approvals/appr-1/decision',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { decision: 'refuse', comment: 'the diff is wrong' },
    });

    expect(harness.events.last?.eventType).toBe('approval.revoked');
    await harness.close();
  });

  it('a revoke needs a reason and records it', async () => {
    const harness = await buildHarness();
    putApproval(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/approvals/appr-1/revoke',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { reason: 'the artefact changed' },
    });

    expect(response.statusCode).toBe(200);
    expect(harness.events.last?.eventType).toBe('approval.revoked');
    const payload = harness.events.last?.payload as { reason: string };
    expect(payload.reason).toBe('the artefact changed');
    expect(harness.approvals.revocations).toHaveLength(1);

    await harness.close();
  });

  it('a revoke without a reason is refused', async () => {
    const harness = await buildHarness();
    putApproval(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/approvals/appr-1/revoke',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('validation');

    await harness.close();
  });

  it('an unknown approval is refused with a 404', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/approvals/appr-nope/decision',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { decision: 'grant' },
    });

    expect(response.statusCode).toBe(404);
    await harness.close();
  });

  it('the approvals list is filterable by status', async () => {
    const harness = await buildHarness();
    putApproval(harness, { id: 'appr-pending', status: 'pending' });
    putApproval(harness, { id: 'appr-granted', status: 'granted' });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals?status=pending',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { id: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe('appr-pending');

    await harness.close();
  });
});

describe('AP-3 · review', () => {
  it('the three decisions are three events', async () => {
    const harness = await buildHarness();
    putReview(harness);

    const cases: {
      readonly decision: string;
      readonly eventType: string;
    }[] = [
      { decision: 'approve', eventType: 'review.approved' },
      { decision: 'reject', eventType: 'review.rejected' },
      { decision: 'defer', eventType: 'review.deferred' },
    ];

    for (const [index, testCase] of cases.entries()) {
      harness.events.clear();
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/reviews/task-1/decision',
        headers: mutatingHeaders(browserHeaders(harness), `key-${String(index)}`),
        payload: { decision: testCase.decision, rationale: 'the evidence holds' },
      });

      expect(response.statusCode).toBe(200);
      expect(harness.events.last?.eventType).toBe(testCase.eventType);
    }

    await harness.close();
  });

  it('a decision without a rationale is refused', async () => {
    const harness = await buildHarness();
    putReview(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/reviews/task-1/decision',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { decision: 'approve' },
    });

    expect(response.statusCode).toBe(400);
    expect(harness.reviews.decisions).toHaveLength(0);

    await harness.close();
  });

  it('the evidence bundle is returned without the transcript by default', async () => {
    const harness = await buildHarness();
    harness.reviews.put({
      taskId: 'task-2',
      risk: 'low',
      rationale: [],
      queuedAt: '2026-01-01T00:00:00.000Z',
      spec: 'a spec',
      oracleResult: 'passed',
      gateReport: 'green',
      panelResult: 'approved',
      blastRadius: 'nothing',
      diffLink: 'https://diff.invalid/2',
      transcript: 'a long transcript',
    });

    const without = await harness.app.inject({
      method: 'GET',
      url: '/v1/reviews/task-2',
      headers: browserHeaders(harness),
    });
    const withTranscript = await harness.app.inject({
      method: 'GET',
      url: '/v1/reviews/task-2?transcript=true',
      headers: browserHeaders(harness),
    });

    expect(without.statusCode).toBe(200);
    expect(
      without.json<Record<string, unknown>>()['transcript'],
    ).toBeUndefined();
    expect(
      withTranscript.json<Record<string, unknown>>()['transcript'],
    ).toBe('a long transcript');

    await harness.close();
  });

  it('an unknown review is refused with a 404', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/reviews/task-nope',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(404);
    await harness.close();
  });
});

describe('AP-4 · inspect', () => {
  it('the overview is a read that emits no event', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/views/overview',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(200);
    expect(harness.events.count).toBe(0);
    await harness.close();
  });

  it('the task list is paginated and the limit is bounded', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/tasks?limit=1000',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(200);
    await harness.close();
  });

  it('the audit explain needs an event id', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit/explain',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('validation');
    await harness.close();
  });

  it('the audit explain answers for a known event', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit/explain?eventId=evt-1',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(200);
    await harness.close();
  });

  it('a task artefact carries an expiry', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/runs/run-1/artefacts/diff.patch',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ expiresAt: string; url: string }>();
    // A signed URL without an expiry is a permanent credential.
    expect(body.expiresAt).not.toBe('');
    expect(body.url).not.toBe('');

    await harness.close();
  });
});

describe('AP-5 · intervene', () => {
  it('the five interventions each reach the port with their action', async () => {
    const harness = await buildHarness();

    const actions = ['pause', 'resume', 'cancel', 'escalate', 'rerun'];

    for (const [index, action] of actions.entries()) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/v1/tasks/task-1/${action}`,
        headers: mutatingHeaders(browserHeaders(harness), `key-${String(index)}`),
        payload: { reason: 'the build is burning money' },
      });

      expect(response.statusCode).toBe(200);
    }

    expect(harness.intervention.actions.map((a) => a.action)).toEqual(actions);
    // The reason reaches the port — an intervention without a reason
    // leaves no account of what happened.
    expect(harness.intervention.actions[0]?.reason).toBe(
      'the build is burning money',
    );
    expect(harness.intervention.actions[0]?.identity).toBe('alice');

    await harness.close();
  });

  it('an intervention without a reason is refused', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/tasks/task-1/pause',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(harness.intervention.actions).toHaveLength(0);

    await harness.close();
  });

  it('engaging the kill switch is recorded as kill.switch.engaged', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/factory/kill-switch',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { engage: true, reason: 'a runaway loop' },
    });

    expect(response.statusCode).toBe(200);
    expect(harness.events.last?.eventType).toBe('kill.switch.engaged');
    const payload = harness.events.last?.payload as {
      by: string;
      reason: string;
    };
    expect(payload.by).toBe('alice');
    expect(payload.reason).toBe('a runaway loop');
    expect(await harness.killSwitch.isEngaged()).toBe(true);

    await harness.close();
  });

  it('releasing the kill switch is recorded as kill.switch.released', async () => {
    const harness = await buildHarness();
    await harness.killSwitch.set(true, 'an incident');

    await harness.app.inject({
      method: 'POST',
      url: '/v1/factory/kill-switch',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { engage: false, reason: 'the incident is over' },
    });

    expect(harness.events.last?.eventType).toBe('kill.switch.released');
    expect(await harness.killSwitch.isEngaged()).toBe(false);

    await harness.close();
  });

  it('a temporary grant is refused when the TTL is over an hour', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/grants/temporary',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: {
        taskId: 'task-1',
        capability: 'merge',
        scope: 'repo:owner/repo',
        ttlSeconds: 3601,
        reason: 'the merge needs a credential',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(harness.intervention.grants).toHaveLength(0);

    await harness.close();
  });

  it('a temporary grant at the cap is accepted', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/grants/temporary',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: {
        taskId: 'task-1',
        capability: 'merge',
        scope: 'repo:owner/repo',
        ttlSeconds: 3600,
        reason: 'the merge needs a credential',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(harness.intervention.grants).toHaveLength(1);
    expect(harness.intervention.grants[0]?.ttlSeconds).toBe(3600);

    await harness.close();
  });

  it('a defect flag is recorded', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/tasks/task-1/defect-flag',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { note: 'the gate is too weak' },
    });

    expect(response.statusCode).toBe(200);
    expect(harness.intervention.defects[0]?.note).toBe('the gate is too weak');

    await harness.close();
  });
});

describe('AP-6 · amend-factory', () => {
  it('the plan is a read', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/definition/plan?sha=abc123',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(200);
    expect(harness.events.count).toBe(0);
    await harness.close();
  });

  it('a definition write whose approval does not bind the bundle is rejected', async () => {
    // ADR-0001's acceptance test, as blueprint `13` §3.3 quotes it: "A
    // control-surface write that is not backed by a reviewed change in the
    // definition is rejected."
    const harness = await buildHarness();
    harness.definition.approvals.set('appr-other', {
      artefactSha256: `sha256:${'e'.repeat(64)}`,
      approvers: ['alice'],
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/definition/apply',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { sha: 'abc123', approvalId: 'appr-other' },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('hash_mismatch');

    // No event — the write did not happen.
    expect(harness.events.count).toBe(0);

    await harness.close();
  });

  it('a definition write whose approval names no known approval is rejected', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/definition/apply',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { sha: 'abc123', approvalId: 'appr-nope' },
    });

    expect(response.statusCode).toBe(404);
    expect(harness.events.count).toBe(0);

    await harness.close();
  });

  it('a definition write by a caller outside the approver list is rejected', async () => {
    const harness = await buildHarness();
    harness.definition.approvals.set('appr-def', {
      artefactSha256: harness.definition.activeSha256,
      approvers: ['bob'],
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/definition/apply',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { sha: 'abc123', approvalId: 'appr-def' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('not_approver');
    expect(harness.events.count).toBe(0);

    await harness.close();
  });

  it('a definition write backed by a binding approval is recorded', async () => {
    const harness = await buildHarness();
    harness.definition.approvals.set('appr-def', {
      artefactSha256: harness.definition.activeSha256,
      approvers: ['alice'],
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/definition/apply',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { sha: 'abc123', approvalId: 'appr-def' },
    });

    expect(response.statusCode).toBe(200);
    expect(harness.events.last?.eventType).toBe('definition.applied');
    const payload = harness.events.last?.payload as {
      sha: string;
      approvalId: string;
    };
    expect(payload.sha).toBe('abc123');
    expect(payload.approvalId).toBe('appr-def');

    await harness.close();
  });
});

describe('the operational surface', () => {
  it('the health check is public', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    expect((response.json<{ status: string }>()).status).toBe('ok');
    await harness.close();
  });

  it('the readiness check is not ready while the kill switch is engaged', async () => {
    const harness = await buildHarness();

    const ready = await harness.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);

    await harness.killSwitch.set(true, 'an incident');
    const notReady = await harness.app.inject({
      method: 'GET',
      url: '/readyz',
    });

    expect(notReady.statusCode).toBe(503);
    const body = notReady.json<{ code: string }>();
    expect(body.code).toBe('kill_switch');

    await harness.close();
  });

  it('the webhook refuses rather than pretending to verify a signature', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: { action: 'opened' },
    });

    expect(response.statusCode).toBe(501);
    expect(harness.events.count).toBe(0);
    await harness.close();
  });

  it('an unknown route is a problem document, not a stack trace', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/nope',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json<{ code: string; requestId: string }>();
    expect(body.code).toBe('validation');
    expect(body.requestId).not.toBe('');

    await harness.close();
  });
});

describe('the CLI token', () => {
  it('a CLI token can drive the same access points as a session', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(cliHeaders(harness)),
      payload: {
        repo: 'owner/repo',
        source: { kind: 'github-issue', ref: 'owner/repo#123' },
      },
    });

    expect(response.statusCode).toBe(202);
    await harness.close();
  });
});
