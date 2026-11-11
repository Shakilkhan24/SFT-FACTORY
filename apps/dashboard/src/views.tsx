/**
 * `dashboard/views` — the one view (T-1.16).
 *
 * ## The promise this file keeps
 *
 * blueprint `15` §6.1 and blueprint `13` §8.1: the dashboard is **one
 * view**, and it must answer *"what is the factory doing and what does
 * it need from me"* in **≤2 clicks** (NFR-07: "without navigating more
 * than two levels").
 *
 * So the layout is the pack's five regions, in the pack's order, on
 * **one page**. There is no navigation, no route, no tab. The two
 * clicks are:
 *
 * 1. **see** the item in "Needs you" (the risk-ordered region puts the
 *    most dangerous thing first);
 * 2. **click** it, which opens its timeline.
 *
 * Anything that required a third click would break the promise, so
 * there is nothing behind a third click.
 *
 * ## The kill switch is here, and it is guarded
 *
 * blueprint `15` §6.3: the intervention verbs are "read-and-request" —
 * the dashboard **cannot write to the definition**. So the kill switch
 * button does not write to the definition either; it POSTs to the
 * access point, and it asks for a reason first, because a switch engaged
 * without a reason cannot be released by whoever finds it.
 *
 * The switch is in the dashboard because the ticket names it, and
 * because "is the factory taking new work?" is the first question an
 * operator has.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ApiClient,
  CostItem,
  HealthItem,
  InFlightItem,
  NeedsYouItem,
  Overview,
  RecentOutcomeItem,
} from './api.js';
import { formatAge, formatUsd } from './api.js';
import { decideKillSwitch, killSwitchMessage as reachedMessage } from './kill-switch.js';
import { selectRegions } from './regions.js';
import { openStream, type StreamChannel } from './stream.js';
import { Timeline } from './timeline.js';

/**
 * The view's props.
 */
export interface DashboardProps {
  /** The client to read with. */
  readonly client: ApiClient;
  /** The moment to measure ages against — injected. */
  readonly now: Date;
  /** Open the live stream. Injected, so a test needs no server. */
  readonly openStream?: typeof openStream;
  /** Engage or release the kill switch. Injected, so a test needs no server. */
  readonly setKillSwitch?: (engage: boolean, reason: string) => Promise<string | undefined>;
}

/**
 * The state of the load.
 */
type LoadState = 'loading' | 'ready' | 'failed';

/**
 * The one view.
 */
export const Dashboard = (props: DashboardProps): React.JSX.Element => {
  const { client, now, openStream: open, setKillSwitch } = props;

  const [overview, setOverview] = useState<Overview>({
    needsYou: [],
    inFlight: [],
    recentOutcomes: [],
    health: [],
    cost: [],
  });
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | undefined>(undefined);
  const [openTaskId, setOpenTaskId] = useState<string | undefined>(undefined);
  const [killSwitchOn, setKillSwitchOn] = useState(false);
  const [killSwitchMessage, setKillSwitchMessage] = useState<string | undefined>(undefined);

  const channelRef = useRef<StreamChannel | undefined>(undefined);

  /**
   * Read the overview.
   */
  const refresh = useCallback((): void => {
    client
      .overview()
      .then((loaded) => {
        setOverview(loaded);
        setState('ready');
        setError(undefined);
      })
      .catch((cause: unknown) => {
        setState('failed');
        setError(cause instanceof Error ? cause.message : 'the overview could not be read');
      });
  }, [client]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The live stream. It is opened once and closed on unmount — a stream
  // that outlives its component would keep the page alive.
  useEffect(() => {
    const opener = open ?? openStream;
    const channel = opener(() => {
      refresh();
    });
    channelRef.current = channel;
    return () => {
      channel.close();
      channelRef.current = undefined;
    };
  }, [open, refresh]);

  const regions = useMemo(() => selectRegions(overview, now), [overview, now]);

  /**
   * Flip the kill switch.
   *
   * The decision is **pure** and lives in `kill-switch.ts` — so it can
   * be unit-tested without a browser, and so the reason's rule (a blank
   * reason is refused) is stated once rather than inlined here.
   */
  const flipKillSwitch = (): void => {
    const decision = decideKillSwitch(
      window.prompt('Why are you flipping the kill switch?'),
      killSwitchOn,
      setKillSwitch !== undefined,
    );
    if (decision.kind === 'cancelled') {
      return;
    }
    if (decision.kind === 'refused') {
      setKillSwitchMessage(decision.message);
      return;
    }
    const next = decision.engage;
    const reason = decision.reason;
    const flip = setKillSwitch;
    if (flip === undefined) {
      setKillSwitchMessage('the kill switch is not wired');
      return;
    }
    flip(next, reason)
      .then((failure) => {
        if (failure === undefined) {
          setKillSwitchOn(next);
          setKillSwitchMessage(reachedMessage(next));
        } else {
          setKillSwitchMessage(failure);
        }
      })
      .catch((cause: unknown) => {
        setKillSwitchMessage(cause instanceof Error ? cause.message : 'the kill switch could not be flipped');
      });
  };

  return (
    <main className="dashboard" data-testid="dashboard">
      <header className="dashboard__header">
        <h1 className="dashboard__title">Factory</h1>
        <div className="dashboard__controls">
          {overview.streamTick === undefined ? null : (
            <span className="dashboard__stream-tick" data-testid="stream-tick">
              {`stream: ${String(overview.streamTick)}`}
            </span>
          )}
          <button
            type="button"
            className="dashboard__kill-switch"
            data-testid="kill-switch"
            data-engaged={killSwitchOn ? 'true' : 'false'}
            onClick={flipKillSwitch}
          >
            {killSwitchOn ? 'kill switch: engaged' : 'kill switch: released'}
          </button>
          {killSwitchMessage === undefined ? null : (
            <span className="dashboard__kill-switch-message" data-testid="kill-switch-message">
              {killSwitchMessage}
            </span>
          )}
        </div>
      </header>

      {state === 'loading' ? (
        <p className="dashboard__status" data-testid="dashboard-loading">
          loading…
        </p>
      ) : null}
      {state === 'failed' ? (
        <p className="dashboard__status dashboard__status--failed" data-testid="dashboard-failed">
          {error ?? 'the overview could not be read'}
        </p>
      ) : null}

      <div className="dashboard__regions">
        <Region
          title={regions.needsYou.title}
          status={regions.needsYou.status}
          alarm={regions.needsYou.alarm}
          testId="region-needs-you"
        >
          {regions.needsYou.items.map((raw, index) => {
            const item = raw as NeedsYouItem;
            return (
              <NeedsYouRow
                key={`${item.taskId ?? 'item'}-${String(index)}`}
                item={item}
                now={now}
                onOpen={() => {
                  const taskId = item.taskId;
                  if (taskId !== undefined) {
                    setOpenTaskId(taskId);
                  }
                }}
              />
            );
          })}
        </Region>

        <Region
          title={regions.inFlight.title}
          status={regions.inFlight.status}
          alarm={regions.inFlight.alarm}
          testId="region-in-flight"
        >
          {regions.inFlight.items.map((raw, index) => {
            const item = raw as InFlightItem;
            return (
              <InFlightRow
                key={`${item.taskId ?? 'item'}-${String(index)}`}
                item={item}
                now={now}
                onOpen={() => {
                  const taskId = item.taskId;
                  if (taskId !== undefined) {
                    setOpenTaskId(taskId);
                  }
                }}
              />
            );
          })}
        </Region>

        <Region
          title={regions.recentOutcomes.title}
          status={regions.recentOutcomes.status}
          alarm={regions.recentOutcomes.alarm}
          testId="region-recent-outcomes"
        >
          {regions.recentOutcomes.items.map((raw, index) => {
            const item = raw as RecentOutcomeItem;
            return (
              <OutcomeRow
                key={`${item.taskId ?? 'item'}-${String(index)}`}
                item={item}
                now={now}
              />
            );
          })}
        </Region>

        <Region
          title={regions.health.title}
          status={regions.health.status}
          alarm={regions.health.alarm}
          testId="region-health"
        >
          {regions.health.items.map((raw, index) => {
            const item = raw as HealthItem;
            return (
              <HealthRow
                key={`${item.capability ?? 'item'}-${String(index)}`}
                item={item}
              />
            );
          })}
        </Region>

        <Region
          title={regions.cost.title}
          status={regions.cost.status}
          alarm={regions.cost.alarm}
          testId="region-cost"
        >
          {regions.cost.items.map((raw, index) => {
            const item = raw as CostItem;
            return (
              <CostRow
                key={`${item.day ?? 'day'}-${item.workflow ?? 'workflow'}-${String(index)}`}
                item={item}
              />
            );
          })}
        </Region>
      </div>

      {openTaskId === undefined ? null : (
        <Timeline
          taskId={openTaskId}
          client={client}
          now={now}
          onClose={() => {
            setOpenTaskId(undefined);
          }}
        />
      )}
    </main>
  );
};

/**
 * A region's props.
 */
interface RegionProps {
  readonly title: string;
  readonly status: string;
  readonly alarm: boolean;
  readonly testId: string;
  readonly children: React.ReactNode;
}

/**
 * One region.
 *
 * The status is **never empty** — a region that has nothing to say says
 * so, so the human is never looking at an unexplained blank.
 */
const Region = (props: RegionProps): React.JSX.Element => {
  const { title, status, alarm, testId, children } = props;
  return (
    <section
      className="region"
      data-testid={testId}
      data-alarm={alarm ? 'true' : 'false'}
      aria-label={title}
    >
      <header className="region__header">
        <h2 className="region__title">{title}</h2>
        <span className="region__status" data-testid={`${testId}-status`}>
          {status}
        </span>
      </header>
      <div className="region__body">{children}</div>
    </section>
  );
};

/**
 * One row of the **Needs you** region.
 *
 * It is a **button**, because clicking it is the second click of the
 * ≤2-click promise — and a button is focusable and reachable by
 * keyboard, which a `<div>` with a click handler would not be.
 */
const NeedsYouRow = (props: {
  readonly item: NeedsYouItem;
  readonly now: Date;
  readonly onOpen: () => void;
}): React.JSX.Element => {
  const { item, now, onOpen } = props;
  const title = item.title ?? item.approvalId ?? item.reviewId ?? item.taskId ?? 'an item';
  return (
    <button
      type="button"
      className="row row--needs-you"
      data-testid="needs-you-item"
      data-kind={item.kind ?? 'unknown'}
      data-risk-tier={item.riskTier ?? 'unknown'}
      onClick={onOpen}
    >
      <span className="row__risk">{item.riskTier ?? '—'}</span>
      <span className="row__title">{title}</span>
      <span className="row__meta">
        {item.kind === undefined ? '' : `${item.kind} · `}
        {item.expiresAt === undefined
          ? 'no expiry'
          : `expires in ${formatAge(item.expiresAt, now)}`}
      </span>
      {item.taskId === undefined ? null : (
        <span className="row__task">{item.taskId}</span>
      )}
    </button>
  );
};

/**
 * One row of the **In flight** region.
 */
const InFlightRow = (props: {
  readonly item: InFlightItem;
  readonly now: Date;
  readonly onOpen: () => void;
}): React.JSX.Element => {
  const { item, now, onOpen } = props;
  return (
    <button
      type="button"
      className="row row--in-flight"
      data-testid="in-flight-item"
      onClick={onOpen}
    >
      <span className="row__title">{item.taskId ?? 'unknown'}</span>
      <span className="row__meta">
        {item.workflow ?? 'unknown workflow'} · {item.stage ?? 'unknown stage'}
      </span>
      <span className="row__age">{formatAge(item.lastActivityAt, now)}</span>
      <span className="row__cost">{formatUsd(item.spentUsdMicros)}</span>
      {item.isolationTier === undefined ? null : (
        <span className="row__tier">{item.isolationTier}</span>
      )}
      {item.nextExpectedEvent === undefined ? null : (
        <span className="row__next">next: {item.nextExpectedEvent}</span>
      )}
    </button>
  );
};

/**
 * One row of the **Recent outcomes** region.
 */
const OutcomeRow = (props: {
  readonly item: RecentOutcomeItem;
  readonly now: Date;
}): React.JSX.Element => {
  const { item, now } = props;
  return (
    <div className="row row--outcome" data-testid="outcome-item">
      <span className="row__title">{item.taskId ?? 'unknown'}</span>
      <span className="row__meta" data-testid="outcome-kind">
        {item.outcome ?? 'unknown'}
        {item.failureClassification === undefined
          ? ''
          : ` · ${item.failureClassification}`}
      </span>
      <span className="row__age">{formatAge(item.completedAt, now)}</span>
    </div>
  );
};

/**
 * One row of the **Health** region.
 */
const HealthRow = (props: { readonly item: HealthItem }): React.JSX.Element => {
  const { item } = props;
  return (
    <div className="row row--health" data-testid="health-item" data-severity={item.severity ?? 'unknown'}>
      <span className="row__title">{item.capability ?? 'unknown'}</span>
      <span className="row__meta">{item.detail ?? 'no detail'}</span>
      <span className="row__severity">{item.severity ?? 'unknown'}</span>
    </div>
  );
};

/**
 * One row of the **Cost** region.
 */
const CostRow = (props: { readonly item: CostItem }): React.JSX.Element => {
  const { item } = props;
  return (
    <div className="row row--cost" data-testid="cost-item">
      <span className="row__title">{item.day ?? 'unknown day'}</span>
      <span className="row__meta">
        {item.workflow ?? 'unknown workflow'}
        {item.stage === undefined ? '' : ` · ${item.stage}`}
      </span>
      <span className="row__cost">{formatUsd(item.usdMicros)}</span>
    </div>
  );
};
