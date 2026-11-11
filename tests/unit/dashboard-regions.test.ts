/**
 * `dashboard/regions` — the five regions, purely (T-1.16).
 *
 * ## What this file proves
 *
 * The region logic is **pure** — no browser, no fetch, no wall clock
 * that is not injected. So it can be tested under Vitest with nothing
 * running. That is the point of the seam: the Playwright oracle proves
 * the browser can reach an item in two clicks, and this file proves the
 * *ordering* is right.
 *
 * The ordering is not decoration. blueprint `15` §6.2 says the
 * approvals are "**risk-ordered**", and blueprint `15` §3.4 says a task
 * that has gone quiet is "likely wedged" — so the oldest task comes
 * first. Those are two claims that a rendering test would not catch,
 * because a rendering test would pass with any order.
 */

import { describe, expect, it } from 'vitest';

import {
  formatAge,
  formatUsd,
  parseOverview,
  type FetchLike,
  buildApiClient,
} from '../../apps/dashboard/src/api.js';
import {
  HEALTH_SEVERITIES,
  REGION_ORDER,
  REGION_TITLES,
  RISK_TIERS,
  compareUnknownsLast,
  riskRank,
  selectCost,
  selectHealth,
  selectInFlight,
  selectNeedsYou,
  selectRecentOutcomes,
  selectRegions,
  severityRank,
  timeSince,
  timeUntil,
  totalUsdMicros,
  usdPerAcceptedChange,
} from '../../apps/dashboard/src/regions.js';

/**
 * The moment every test is taken at.
 */
const NOW = new Date('2026-11-11T12:00:00.000Z');

describe('the risk ordering', () => {
  it('puts the most dangerous tier first', () => {
    expect(RISK_TIERS[0]).toBe('R4');
    expect(RISK_TIERS[RISK_TIERS.length - 1]).toBe('R0');
  });

  it('ranks a known tier above an unknown one', () => {
    expect(riskRank('R4')).toBeGreaterThan(riskRank('R3'));
    expect(riskRank('R0')).toBeGreaterThan(riskRank(undefined));
    expect(riskRank('R9')).toBe(riskRank(undefined));
  });

  it('reads the tier case-insensitively', () => {
    expect(riskRank('r4')).toBe(riskRank('R4'));
  });
});

describe('the Needs you region', () => {
  it('orders by blast radius, most dangerous first', () => {
    const items = [
      { id: 'low', riskTier: 'R1' },
      { id: 'critical', riskTier: 'R4' },
      { id: 'high', riskTier: 'R3' },
    ];
    expect(selectNeedsYou(items, NOW).map((item) => item.id)).toEqual([
      'critical',
      'high',
      'low',
    ]);
  });

  it('sorts an item with no tier last, not first', () => {
    // An unknown risk is not a high risk. Putting it first would bury
    // the known-critical work under the unknown.
    const items = [{ id: 'unknown' }, { id: 'critical', riskTier: 'R4' }];
    expect(selectNeedsYou(items, NOW).map((item) => item.id)).toEqual([
      'critical',
      'unknown',
    ]);
  });

  it('breaks a tier tie by urgency, soonest expiry first', () => {
    const items = [
      { id: 'later', riskTier: 'R2', expiresAt: '2026-11-11T13:00:00.000Z' },
      { id: 'sooner', riskTier: 'R2', expiresAt: '2026-11-11T12:10:00.000Z' },
    ];
    expect(selectNeedsYou(items, NOW).map((item) => item.id)).toEqual([
      'sooner',
      'later',
    ]);
  });

  it('sorts an item with no expiry last on urgency', () => {
    const items = [
      { id: 'unknown-expiry', riskTier: 'R2' },
      { id: 'known', riskTier: 'R2', expiresAt: '2026-11-11T13:00:00.000Z' },
    ];
    expect(selectNeedsYou(items, NOW).map((item) => item.id)).toEqual([
      'known',
      'unknown-expiry',
    ]);
  });

  it('breaks the final tie by how long it has waited', () => {
    const items = [
      { id: 'newer', riskTier: 'R2', requestedAt: '2026-11-11T11:00:00.000Z' },
      { id: 'older', riskTier: 'R2', requestedAt: '2026-11-10T11:00:00.000Z' },
    ];
    expect(selectNeedsYou(items, NOW).map((item) => item.id)).toEqual([
      'older',
      'newer',
    ]);
  });

  it('does not mutate the input', () => {
    const items = [
      { id: 'low', riskTier: 'R1' },
      { id: 'critical', riskTier: 'R4' },
    ];
    const before = items.map((item) => item.id);
    selectNeedsYou(items, NOW);
    expect(items.map((item) => item.id)).toEqual(before);
  });
});

describe('the unknown-timestamp case', () => {
  it('does not produce NaN when two items are both unknown', () => {
    // `Infinity - Infinity` is `NaN`, and a comparator that returns
    // `NaN` gives the sort no order at all — `NaN !== 0` is true, so
    // the comparator claims a difference and the engine's behaviour
    // becomes whatever it happens to be. This case is real: two
    // approvals with no expiry is the normal case, not an edge one.
    const items = [
      { id: 'older', riskTier: 'R2', requestedAt: '2026-11-10T11:00:00.000Z' },
      { id: 'newer', riskTier: 'R2', requestedAt: '2026-11-11T11:00:00.000Z' },
    ];
    expect(selectNeedsYou(items, NOW).map((item) => item.id)).toEqual([
      'older',
      'newer',
    ]);
  });

  it('keeps two unknown requested times in a stable order', () => {
    const items = [
      { id: 'first', riskTier: 'R2' },
      { id: 'second', riskTier: 'R2' },
    ];
    expect(selectNeedsYou(items, NOW).map((item) => item.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('keeps two unknown last-activity times in a stable order', () => {
    const items = [
      { taskId: 'first' },
      { taskId: 'second' },
    ];
    expect(selectInFlight(items, NOW).map((item) => item.taskId)).toEqual([
      'first',
      'second',
    ]);
  });

  it('puts an unknown completion time last', () => {
    const items = [
      { taskId: 'unknown' },
      { taskId: 'known', completedAt: '2026-11-11T11:00:00.000Z' },
    ];
    expect(selectRecentOutcomes(items, NOW).map((item) => item.taskId)).toEqual([
      'known',
      'unknown',
    ]);
  });

  it('compares unknown distances without NaN', () => {
    expect(compareUnknownsLast(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0);
    expect(compareUnknownsLast(Number.POSITIVE_INFINITY, 1)).toBe(1);
    expect(compareUnknownsLast(1, Number.POSITIVE_INFINITY)).toBe(-1);
    expect(compareUnknownsLast(1, 2)).toBe(-1);
  });
});

describe('the In flight region', () => {
  it('orders by age, the quietest task first', () => {
    // blueprint 15 §3.4: a task that has gone quiet is likely wedged.
    const items = [
      { id: 'fresh', lastActivityAt: '2026-11-11T11:59:00.000Z' },
      { id: 'stale', lastActivityAt: '2026-11-11T09:00:00.000Z' },
      { id: 'middle', lastActivityAt: '2026-11-11T11:00:00.000Z' },
    ];
    expect(selectInFlight(items, NOW).map((item) => item.id)).toEqual([
      'stale',
      'middle',
      'fresh',
    ]);
  });

  it('puts a task with no activity first — silence is the signal', () => {
    const items = [
      { id: 'fresh', lastActivityAt: '2026-11-11T11:59:00.000Z' },
      { id: 'silent' },
    ];
    expect(selectInFlight(items, NOW).map((item) => item.id)).toEqual([
      'silent',
      'fresh',
    ]);
  });

  it('breaks an age tie by task id, so the order is total', () => {
    const items = [
      { taskId: 'b', lastActivityAt: '2026-11-11T11:00:00.000Z' },
      { taskId: 'a', lastActivityAt: '2026-11-11T11:00:00.000Z' },
    ];
    expect(selectInFlight(items, NOW).map((item) => item.taskId)).toEqual(['a', 'b']);
  });
});

describe('the Recent outcomes region', () => {
  it('orders most recent first', () => {
    const items = [
      { id: 'older', completedAt: '2026-11-10T10:00:00.000Z' },
      { id: 'newer', completedAt: '2026-11-11T10:00:00.000Z' },
    ];
    expect(selectRecentOutcomes(items, NOW).map((item) => item.id)).toEqual([
      'newer',
      'older',
    ]);
  });
});

describe('the Health region', () => {
  it('puts a failing gate before a degraded one', () => {
    expect(HEALTH_SEVERITIES[0]).toBe('failing');
    const items = [
      { id: 'degraded', severity: 'degraded' },
      { id: 'failing', severity: 'failing' },
      { id: 'stale', severity: 'stale' },
    ];
    expect(selectHealth(items, NOW).map((item) => item.id)).toEqual([
      'failing',
      'degraded',
      'stale',
    ]);
  });

  it('sorts an unknown severity last', () => {
    expect(severityRank('failing')).toBeGreaterThan(severityRank(undefined));
    expect(severityRank('nonsense')).toBe(severityRank(undefined));
  });
});

describe('the Cost region', () => {
  it('orders by cost, most expensive first', () => {
    const items = [
      { id: 'cheap', usdMicros: 1000 },
      { id: 'dear', usdMicros: 5000 },
      { id: 'middle', usdMicros: 2000 },
    ];
    expect(selectCost(items, NOW).map((item) => item.id)).toEqual([
      'dear',
      'middle',
      'cheap',
    ]);
  });

  it('sums the rows for the total', () => {
    expect(
      totalUsdMicros([{ usdMicros: 1000 }, { usdMicros: 2500 }]),
    ).toBe(3500);
  });

  it('gives no figure per accepted change when nothing was accepted', () => {
    // A division by zero is not a number. Reporting "$0.00 per accepted
    // change" would say the work was free when it was unattributed.
    expect(usdPerAcceptedChange([{ usdMicros: 5000 }])).toBeUndefined();
    expect(
      usdPerAcceptedChange([{ usdMicros: 5000, acceptedChangeCount: 0 }]),
    ).toBeUndefined();
  });

  it('divides the total by the accepted changes', () => {
    expect(
      usdPerAcceptedChange([
        { usdMicros: 5000, acceptedChangeCount: 2 },
        { usdMicros: 1000, acceptedChangeCount: 1 },
      ]),
    ).toBe(2000);
  });
});

describe('the time helpers', () => {
  it('reads an unparseable timestamp as unknown, not as now', () => {
    expect(timeUntil('not-a-date', NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(timeSince('not-a-date', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('reads an absent timestamp as unknown, not as now', () => {
    // An absent expiry is **unknown**, and an unknown expiry is not
    // urgent. If this returned a finite distance — or a negative one —
    // an item with no expiry would sort first, which is exactly the
    // wrong answer for the item nobody set a deadline on.
    expect(timeUntil(undefined, NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(timeSince(undefined, NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('measures a future expiry as a positive distance', () => {
    expect(timeUntil('2026-11-11T12:00:30.000Z', NOW)).toBe(30_000);
  });
});

describe('the five regions', () => {
  const overview = {
    needsYou: [
      { taskId: 't1', riskTier: 'R4' },
      { taskId: 't2', riskTier: 'R1' },
    ],
    inFlight: [{ taskId: 't3', lastActivityAt: '2026-11-11T10:00:00.000Z' }],
    recentOutcomes: [{ taskId: 't4', completedAt: '2026-11-11T11:00:00.000Z' }],
    health: [{ capability: 'gates', severity: 'failing' }],
    cost: [{ day: '2026-11-11', usdMicros: 2500, acceptedChangeCount: 1 }],
  };

  it('has the five regions in the pack’s order', () => {
    expect(REGION_ORDER).toEqual([
      'needsYou',
      'inFlight',
      'recentOutcomes',
      'health',
      'cost',
    ]);
    expect(REGION_TITLES.needsYou).toBe('Needs you');
    expect(REGION_TITLES.inFlight).toBe('In flight');
    expect(REGION_TITLES.recentOutcomes).toBe('Recent outcomes');
    expect(REGION_TITLES.health).toBe('Health');
    expect(REGION_TITLES.cost).toBe('Cost');
  });

  it('says what each region holds', () => {
    const regions = selectRegions(overview, NOW);
    expect(regions.needsYou.status).toBe('2 need you');
    expect(regions.inFlight.status).toBe('1 running');
    expect(regions.recentOutcomes.status).toBe('1 recent');
    expect(regions.health.status).toBe('1 degraded');
    expect(regions.cost.status).toBe('per accepted change: 2500');
  });

  it('alarms on Needs you and on a failing gate', () => {
    const regions = selectRegions(overview, NOW);
    expect(regions.needsYou.alarm).toBe(true);
    expect(regions.health.alarm).toBe(true);
    expect(regions.inFlight.alarm).toBe(false);
  });

  it('never shows an unexplained blank', () => {
    const regions = selectRegions(
      {
        needsYou: [],
        inFlight: [],
        recentOutcomes: [],
        health: [],
        cost: [],
      },
      NOW,
    );
    for (const key of REGION_ORDER) {
      expect(regions[key].status.length).toBeGreaterThan(0);
      expect(regions[key].alarm).toBe(false);
    }
    expect(regions.needsYou.status).toBe('nothing needs you');
    expect(regions.health.status).toBe('no health signal');
    expect(regions.cost.status).toBe('no cost recorded');
  });
});

describe('the overview parse', () => {
  it('reads the five regions from the payload', () => {
    const parsed = parseOverview({
      needsYou: [{ taskId: 't1', riskTier: 'R4' }],
      inFlight: [{ taskId: 't2', spentUsdMicros: 100 }],
      recentOutcomes: [{ taskId: 't3', outcome: 'merged' }],
      health: [{ capability: 'gates', severity: 'degraded' }],
      cost: [{ day: '2026-11-11', usdMicros: 5 }],
    });
    expect(parsed.needsYou).toHaveLength(1);
    expect(parsed.inFlight[0]?.spentUsdMicros).toBe(100);
    expect(parsed.recentOutcomes[0]?.outcome).toBe('merged');
    expect(parsed.health[0]?.capability).toBe('gates');
    expect(parsed.cost[0]?.usdMicros).toBe(5);
  });

  it('reads a record-shaped health region as well as a list', () => {
    // The API's port says `health` is a record; the projection will
    // eventually give it a list. Both are accepted.
    const parsed = parseOverview({
      health: { gates: { severity: 'failing' }, budget: { severity: 'degraded' } },
    });
    expect(parsed.health).toHaveLength(2);
    expect(parsed.health.map((item) => item.severity)).toEqual([
      'failing',
      'degraded',
    ]);
  });

  it('yields five empty regions for a payload that is not an object', () => {
    const parsed = parseOverview('nonsense');
    expect(parsed.needsYou).toEqual([]);
    expect(parsed.inFlight).toEqual([]);
    expect(parsed.recentOutcomes).toEqual([]);
    expect(parsed.health).toEqual([]);
    expect(parsed.cost).toEqual([]);
  });

  it('drops a field of the wrong type rather than rendering it', () => {
    const parsed = parseOverview({
      inFlight: [{ taskId: 42, spentUsdMicros: 'lots' }],
    });
    expect(parsed.inFlight[0]?.taskId).toBeUndefined();
    expect(parsed.inFlight[0]?.spentUsdMicros).toBeUndefined();
  });

  it('drops a non-object item from a region', () => {
    const parsed = parseOverview({ needsYou: ['a string', { taskId: 't1' }] });
    expect(parsed.needsYou).toHaveLength(1);
    expect(parsed.needsYou[0]?.taskId).toBe('t1');
  });
});

describe('the display helpers', () => {
  it('formats micro-USD as dollars', () => {
    expect(formatUsd(2_500_000)).toBe('$2.50');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('says unknown rather than guessing a cost', () => {
    expect(formatUsd(undefined)).toBe('unknown');
  });

  it('formats an age in the largest sensible unit', () => {
    expect(formatAge('2026-11-11T11:59:30.000Z', NOW)).toBe('30s');
    expect(formatAge('2026-11-11T11:30:00.000Z', NOW)).toBe('30m');
    expect(formatAge('2026-11-11T09:00:00.000Z', NOW)).toBe('3h');
    expect(formatAge('2026-11-08T12:00:00.000Z', NOW)).toBe('3d');
  });

  it('says unknown for an age it cannot read', () => {
    expect(formatAge(undefined, NOW)).toBe('unknown');
    expect(formatAge('nonsense', NOW)).toBe('unknown');
  });
});

describe('the API client', () => {
  it('reads the overview from /v1/views/overview', async () => {
    const seen: string[] = [];
    const fakeFetch: FetchLike = (input) => {
      seen.push(input);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ needsYou: [{ taskId: 't1' }] }),
      });
    };
    const client = buildApiClient({ fetch: fakeFetch });
    const overview = await client.overview();
    expect(seen).toEqual(['/v1/views/overview']);
    expect(overview.needsYou[0]?.taskId).toBe('t1');
  });

  it('sends the session cookie with a same-origin request', async () => {
    let credentials: string | undefined;
    const fakeFetch: FetchLike = (_input, init) => {
      credentials = init?.credentials;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    };
    await buildApiClient({ fetch: fakeFetch }).overview();
    expect(credentials).toBe('same-origin');
  });

  it('rejects on a failed response rather than rendering nothing', async () => {
    const fakeFetch: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ code: 'kill_switch' }),
      });
    await expect(buildApiClient({ fetch: fakeFetch }).overview()).rejects.toThrow(
      '503',
    );
  });

  it('reads a task’s events from the events route', async () => {
    const seen: string[] = [];
    const fakeFetch: FetchLike = (input) => {
      seen.push(input);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [{ seq: 1 }] }),
      });
    };
    const events = await buildApiClient({ fetch: fakeFetch }).taskEvents('t 1');
    expect(seen).toEqual(['/v1/tasks/t%201/events']);
    expect(events).toHaveLength(1);
  });
});
