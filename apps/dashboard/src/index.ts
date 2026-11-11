/**
 * `dashboard` — the operational surface (T-1.16).
 *
 * apps/* wire packages together; they never import each other
 * (pack 02 §3). So the dashboard talks to the API over HTTP and never
 * imports `apps/api`.
 *
 * ## What is here
 *
 * * `api.ts` — the shapes the API returns and the client that fetches
 *   them;
 * * `regions.ts` — the **pure** selectors that turn one overview into
 *   the five regions. This is the seam: the region logic is testable
 *   without a browser, and the React layer only renders what the
 *   selectors return.
 *
 * The React layer (`main.tsx`, `views.tsx`, `timeline.tsx`,
 * `stream.ts`) is not re-exported here — a Node consumer of this
 * package must not pull React into its dependency graph.
 */

export {
  API_BASE,
  buildApiClient,
  formatAge,
  formatUsd,
  parseOverview,
  type ApiClient,
  type ApiClientOptions,
  type CostItem,
  type FetchLike,
  type HealthItem,
  type InFlightItem,
  type NeedsYouItem,
  type Overview,
  type OverviewPayload,
  type RecentOutcomeItem,
} from './api.js';

export {
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
  type Region,
} from './regions.js';

/**
 * The app's name — the scaffold's marker (T-0.02).
 */
export const appName = 'dashboard';
