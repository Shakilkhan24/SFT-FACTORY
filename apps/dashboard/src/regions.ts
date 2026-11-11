/**
 * `dashboard/regions` — the five regions, derived (T-1.16).
 *
 * ## Why this file is the seam
 *
 * blueprint `15` §6.2 gives the five regions' **content**. blueprint
 * `13` §8.1 gives the same five. So the content is fixed by the pack,
 * and the only question this ticket answers is *how the payload becomes
 * the regions*.
 *
 * The answer: **purely**. Every selector here is a function of its
 * arguments — no `fetch`, no `React`, no clock that is not injected. So
 * the region's logic is testable under Vitest without a browser, and the
 * React layer does nothing but render what these return.
 *
 * That split is what makes the ticket's oracle honest: the Playwright
 * test proves the *browser* can reach an item in two clicks, and the
 * unit test proves the *ordering* is right — two different claims, two
 * different oracles.
 *
 * ## The ordering rules
 *
 * The pack names three orderings, and each has a reason:
 *
 * 1. **Needs you** — "approvals outstanding (**risk-ordered**)". The
 *    ordering is by blast radius, `R4` first: the most dangerous thing
 *    is the thing a human should look at first. An item with no tier
 *    sorts **last**, not first — an unknown risk is not a high risk,
 *    and guessing otherwise would bury the known-critical work under the
 *    unknown.
 * 2. **In flight** — "every running task: workflow, stage, age, cost
 *    so far". The natural order is **age**: the longest-running task is
 *    the one most likely to be wedged (blueprint `15` §3.4: "a task
 *    that has not produced an event within its expected stage duration
 *    is not merely stale — it is likely wedged"). So the oldest task
 *    comes first.
 * 3. **Needs you** also sorts by **urgency** — an approval that
 *    expires in a minute outranks one that expires in an hour, even
 *    when their tiers match. The tier decides *which* class of work to
 *    do; the expiry decides *which* of those to do now.
 *
 * ## What is deliberately not here
 *
 * * **No filtering.** The regions show what the API gave. A filter is a
 *   second view, and blueprint `15` §10.1 says the operational set is
 *   deliberately small.
 * * **No truncation.** Hiding the fourth item would break the ≤2-click
 *   promise for the fourth item.
 * * **No aggregation.** The Cost region sums in `cost.ts`, and the sum
 *   is a *view* of the rows, not a new row.
 */

/**
 * The risk tiers, in order.
 *
 * The contracts call it `Tier` — "R0 trivial · R1 low · R2 moderate ·
 * R3 high · R4 critical". So **higher is worse**, and the sort is
 * descending.
 */
export const RISK_TIERS: readonly string[] = ['R4', 'R3', 'R2', 'R1', 'R0'];

/**
 * The rank of a risk tier — higher is more urgent.
 *
 * An unknown tier ranks **below** every known tier, so an item whose
 * tier the projection did not fill in sorts last. That is the
 * conservative choice: it is visible, but it does not displace a
 * known-critical item.
 */
export const riskRank = (tier: string | undefined): number => {
  if (tier === undefined) {
    return -1;
  }
  const index = RISK_TIERS.indexOf(tier.trim().toUpperCase());
  return index === -1 ? -1 : RISK_TIERS.length - index;
};

/**
 * How long until a timestamp, in milliseconds.
 *
 * `Infinity` when there is no timestamp or it is unparseable — so an
 * item with no expiry sorts **last** on urgency. An item that expires
 * at an unknown time is not urgent; it is unknown.
 */
export const timeUntil = (until: string | undefined, now: Date): number => {
  if (until === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(until);
  if (!Number.isFinite(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return parsed - now.getTime();
};

/**
 * How long ago a timestamp was, in milliseconds.
 *
 * `Infinity` when there is no timestamp — so a task with no activity is
 * the **oldest**, which is right: a task that has not been heard from
 * is the one most likely to be wedged.
 */
export const timeSince = (since: string | undefined, now: Date): number => {
  if (since === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(since);
  if (!Number.isFinite(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return now.getTime() - parsed;
};

/**
 * Compare two distances, with an unknown distance **last**.
 *
 * An unknown distance is `Infinity` — the item's expiry is unreadable,
 * or absent. So `Infinity - Infinity` is `NaN`, and a comparator that
 * returns `NaN` gives the sort no order at all: `NaN !== 0` is true,
 * so the comparator claims a difference and the engine's behaviour
 * becomes whatever it happens to be.
 *
 * So the unknown case is handled **explicitly** rather than by
 * arithmetic: a known distance comes before an unknown one, and two
 * unknowns are equal.
 *
 * @param left the left distance
 * @param right the right distance
 */
export const compareUnknownsLast = (
  left: number,
  right: number,
): number => {
  const leftUnknown = !Number.isFinite(left);
  const rightUnknown = !Number.isFinite(right);
  if (leftUnknown && rightUnknown) {
    return 0;
  }
  if (leftUnknown) {
    return 1;
  }
  if (rightUnknown) {
    return -1;
  }
  return left - right;
};

/**
 * The **Needs you** region, risk-ordered.
 *
 * blueprint `15` §6.2: "Approvals outstanding (risk-ordered),
 * escalations, failures needing a decision".
 *
 * The sort is **stable** on the tie-break of urgency, and the final
 * tie-break is the requested time — the older request first, because it
 * has been waiting longer.
 */
export const selectNeedsYou = <T extends {
  readonly riskTier?: string;
  readonly expiresAt?: string;
  readonly requestedAt?: string;
}>(
  items: readonly T[],
  now: Date,
): readonly T[] => {
  return [...items].sort((left, right) => {
    const byRisk = riskRank(right.riskTier) - riskRank(left.riskTier);
    if (byRisk !== 0) {
      return byRisk;
    }
    const byExpiry = compareUnknownsLast(
      timeUntil(left.expiresAt, now),
      timeUntil(right.expiresAt, now),
    );
    if (byExpiry !== 0) {
      return byExpiry;
    }
    // The **older** request first — it has been waiting longer. So the
    // comparison is the other way round from `timeUntil`: a larger
    // `timeSince` means "waited longer", and it must come first. And an
    // unknown requested time goes **last**, so the comparison goes
    // through `compareUnknownsLast` rather than through arithmetic that
    // would produce `NaN`.
    const byRequested = compareUnknownsLast(
      timeSince(right.requestedAt, now),
      timeSince(left.requestedAt, now),
    );
    return byRequested;
  });
};

/**
 * The **In flight** region, oldest first.
 *
 * blueprint `15` §6.2: "Every running task: workflow, stage, age, cost
 * so far, isolation tier, expected next event".
 *
 * The order is by age, and the tie-break is by task id so the order
 * does not depend on the payload's own ordering.
 */
export const selectInFlight = <T extends {
  readonly lastActivityAt?: string;
  readonly taskId?: string;
}>(
  items: readonly T[],
  now: Date,
): readonly T[] => {
  return [...items].sort((left, right) => {
    // The **quietest** task first: it is the one most likely to be
    // wedged (blueprint `15` §3.4). So the comparison runs the other
    // way round from `timeSince` — a larger age comes first — and an
    // unknown age goes through `compareUnknownsLast`, because
    // `Infinity - Infinity` is `NaN`.
    const byAge = compareUnknownsLast(
      timeSince(right.lastActivityAt, now),
      timeSince(left.lastActivityAt, now),
    );
    if (byAge !== 0) {
      return byAge;
    }
    return (left.taskId ?? '').localeCompare(right.taskId ?? '');
  });
};

/**
 * The **Recent outcomes** region, most recent first.
 *
 * blueprint `15` §6.2: "Merged, rejected, failed, rolled back, with the
 * failure classification". The classification is the point — it is what
 * the improvement loop reads — so it is carried on the item and the
 * order is by completion time.
 */
export const selectRecentOutcomes = <T extends {
  readonly completedAt?: string;
  readonly taskId?: string;
}>(
  items: readonly T[],
  now: Date,
): readonly T[] => {
  return [...items].sort((left, right) => {
    // The **most recent** first — so a smaller age comes first, and an
    // unknown completion time goes last (through
    // `compareUnknownsLast`, because `Infinity - Infinity` is `NaN`).
    const byTime = compareUnknownsLast(
      timeSince(left.completedAt, now),
      timeSince(right.completedAt, now),
    );
    if (byTime !== 0) {
      return byTime;
    }
    return (left.taskId ?? '').localeCompare(right.taskId ?? '');
  });
};

/**
 * The **Health** region, worst first.
 *
 * blueprint `15` §6.2: "Degraded capabilities, failing gates, budget
 * consumption, queue depth, drift".
 *
 * The severity ordering is `failing` before `degraded` before
 * `stale` — the pack's "on breach" column in blueprint `15` §3.4
 * distinguishes them, and a failing gate is the one that stops work.
 */
export const HEALTH_SEVERITIES: readonly string[] = ['failing', 'degraded', 'stale'];

/**
 * The rank of a severity — higher is worse.
 *
 * An unknown severity ranks last, for the same reason an unknown risk
 * tier does.
 */
export const severityRank = (severity: string | undefined): number => {
  if (severity === undefined) {
    return -1;
  }
  const index = HEALTH_SEVERITIES.indexOf(severity.trim().toLowerCase());
  return index === -1 ? -1 : HEALTH_SEVERITIES.length - index;
};

/**
 * The Health region, worst first.
 */
export const selectHealth = <T extends {
  readonly severity?: string;
  readonly capability?: string;
}>(
  items: readonly T[],
  now: Date,
): readonly T[] => {
  void now;
  return [...items].sort((left, right) => {
    const bySeverity = severityRank(right.severity) - severityRank(left.severity);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    return (left.capability ?? '').localeCompare(right.capability ?? '');
  });
};

/**
 * The **Cost** region, most expensive first.
 *
 * blueprint `15` §6.2: "Today, this week, per accepted change, by
 * workflow and stage".
 *
 * The order is by cost, and the tie-break is by the day's bucket key
 * so the order is total.
 */
export const selectCost = <T extends {
  readonly usdMicros?: number;
  readonly day?: string;
  readonly workflow?: string;
}>(
  items: readonly T[],
  now: Date,
): readonly T[] => {
  void now;
  return [...items].sort((left, right) => {
    const byCost = (right.usdMicros ?? 0) - (left.usdMicros ?? 0);
    if (byCost !== 0) {
      return byCost;
    }
    const leftKey = `${left.day ?? ''} ${left.workflow ?? ''}`;
    const rightKey = `${right.day ?? ''} ${right.workflow ?? ''}`;
    return leftKey.localeCompare(rightKey);
  });
};

/**
 * The total of a cost region's rows, in integer micro-USD.
 *
 * The sum is a **view** of the rows, never a row of its own — so the
 * region's total and the region's rows cannot disagree.
 */
export const totalUsdMicros = (
  items: readonly { readonly usdMicros?: number }[],
): number =>
  items.reduce((total, item) => total + (item.usdMicros ?? 0), 0);

/**
 * The cost per accepted change, in integer micro-USD.
 *
 * blueprint `15` §6.2: "Cost … **per accepted change**". This is the
 * measure that matters, because it is the one that says whether the
 * factory is worth running.
 *
 * **No accepted changes means no figure**, not zero — a division by
 * zero is not a number, and reporting `$0.00 per accepted change`
 * would say the work was free when in fact it was unattributed.
 */
export const usdPerAcceptedChange = (
  items: readonly {
    readonly usdMicros?: number;
    readonly acceptedChangeCount?: number;
  }[],
): number | undefined => {
  const accepted = items.reduce(
    (total, item) => total + (item.acceptedChangeCount ?? 0),
    0,
  );
  if (accepted <= 0) {
    return undefined;
  }
  return Math.round(totalUsdMicros(items) / accepted);
};

/**
 * The five regions, derived from one overview.
 *
 * The shape the React layer renders. Each region carries its items and
 * a one-line **status** — so the region can say "3 need you" or "no
 * signal", and the human is never looking at an unexplained blank.
 */
export interface Region<T> {
  /** The region's title. */
  readonly title: string;
  /** The items. */
  readonly items: readonly T[];
  /** A one-line status — never empty. */
  readonly status: string;
  /** Is the region saying something is wrong? */
  readonly alarm: boolean;
}

/**
 * The five regions' titles.
 *
 * blueprint `15` §6.2's table, in the table's order.
 */
export const REGION_TITLES = {
  needsYou: 'Needs you',
  inFlight: 'In flight',
  recentOutcomes: 'Recent outcomes',
  health: 'Health',
  cost: 'Cost',
} as const;

/**
 * The five regions, in the pack's order.
 *
 * The order is the pack's, and the pack's order is the reading order:
 * what needs you, what is happening, what happened, how it is doing,
 * what it cost.
 */
export const REGION_ORDER: readonly (keyof typeof REGION_TITLES)[] = [
  'needsYou',
  'inFlight',
  'recentOutcomes',
  'health',
  'cost',
];

/**
 * Derive the five regions from an overview.
 *
 * @param overview the parsed overview
 * @param now the moment the view is taken at — injected (AGENTS.md §4)
 */
export const selectRegions = (
  overview: {
    readonly needsYou: readonly {
      readonly riskTier?: string;
      readonly expiresAt?: string;
      readonly requestedAt?: string;
    }[];
    readonly inFlight: readonly {
      readonly lastActivityAt?: string;
      readonly taskId?: string;
    }[];
    readonly recentOutcomes: readonly {
      readonly completedAt?: string;
      readonly taskId?: string;
    }[];
    readonly health: readonly {
      readonly severity?: string;
      readonly capability?: string;
    }[];
    readonly cost: readonly {
      readonly usdMicros?: number;
      readonly acceptedChangeCount?: number;
      readonly day?: string;
      readonly workflow?: string;
    }[];
  },
  now: Date,
): {
  readonly needsYou: Region<unknown>;
  readonly inFlight: Region<unknown>;
  readonly recentOutcomes: Region<unknown>;
  readonly health: Region<unknown>;
  readonly cost: Region<unknown>;
} => {
  const needsYouItems = selectNeedsYou(overview.needsYou, now);
  const inFlightItems = selectInFlight(overview.inFlight, now);
  const outcomeItems = selectRecentOutcomes(overview.recentOutcomes, now);
  const healthItems = selectHealth(overview.health, now);
  const costItems = selectCost(overview.cost, now);

  const perChange = usdPerAcceptedChange(overview.cost);

  return {
    needsYou: {
      title: REGION_TITLES.needsYou,
      items: needsYouItems,
      status:
        needsYouItems.length === 0
          ? 'nothing needs you'
          : `${String(needsYouItems.length)} need you`,
      alarm: needsYouItems.length > 0,
    },
    inFlight: {
      title: REGION_TITLES.inFlight,
      items: inFlightItems,
      status:
        inFlightItems.length === 0
          ? 'nothing is running'
          : `${String(inFlightItems.length)} running`,
      alarm: false,
    },
    recentOutcomes: {
      title: REGION_TITLES.recentOutcomes,
      items: outcomeItems,
      status:
        outcomeItems.length === 0
          ? 'no recent outcomes'
          : `${String(outcomeItems.length)} recent`,
      alarm: false,
    },
    health: {
      title: REGION_TITLES.health,
      items: healthItems,
      status:
        healthItems.length === 0
          ? 'no health signal'
          : `${String(healthItems.length)} degraded`,
      alarm: healthItems.some((item) => severityRank(item.severity) > 0),
    },
    cost: {
      title: REGION_TITLES.cost,
      items: costItems,
      status:
        costItems.length === 0
          ? 'no cost recorded'
          : perChange === undefined
            ? 'no accepted change yet'
            : `per accepted change: ${String(perChange)}`,
      alarm: false,
    },
  };
};
