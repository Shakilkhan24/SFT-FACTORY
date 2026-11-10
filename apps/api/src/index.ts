/**
 * `api` — the access-point HTTP surface (T-1.14).
 *
 * ## What this app is
 *
 * The six access points of blueprint `13` §3.1, served over HTTP with
 * the conventions of pack `04` §3:
 *
 * * a **base path** of `/v1`;
 * * JSON in, JSON out;
 * * errors as `application/problem+json` (RFC 9457) with the pack's
 *   `code` and a `requestId`;
 * * browser = GitHub-OAuth session cookie **plus** a CSRF token;
 * * CLI = a bearer token `fac_…`, stored hashed, scoped, expiring and
 *   revocable;
 * * `Idempotency-Key` required on the creating POSTs;
 * * `?cursor=&limit=` pagination;
 * * **no endpoint accepts free-form instructions for an agent**.
 *
 * ## What this app is not
 *
 * It is not a chat interface. blueprint `13` §3.1 says so explicitly:
 * "**Deliberately excluded:** a generic 'chat with the agent' access
 * point." And HR-13: "no chat-with-agent endpoint, no free-form
 * instruction channel, no auto-apply of proposals — ever."
 *
 * The route inventory (`routes.ts`) is the structural proof: the app
 * serves **exactly** the routes in the inventory, and no body schema in
 * the inventory accepts an instruction field.
 */

export {
  buildApp,
  type AppDeps,
  type AppOptions,
  type RegisteredRoute,
  type RequestContext,
  type RouteHandler,
} from './app.js';

export {
  authenticate,
  CLI_TOKEN_PREFIX,
  CSRF_HEADER_NAME,
  hashToken,
  hasScope,
  isCliToken,
  SESSION_COOKIE_NAME,
  type AuthDeps,
  type AuthResult,
  type Credentials,
} from './auth.js';

export {
  actorFor,
  authorityFor,
  buildEvent,
  emit,
  type EventEmitterDeps,
} from './events.js';

export {
  IDEMPOTENCY_HEADER_NAME,
  InMemoryIdempotencyStore,
  recordId,
  type IdempotencyKey,
  type IdempotencyStore,
  type IdempotentRecord,
} from './idempotency.js';

export {
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_WINDOW_MS,
  FixedWindowRateLimiter,
  type RateLimiter,
} from './rate-limit.js';

export {
  DEFAULT_STATUS_BY_CODE,
  PROBLEM_CODES,
  ProblemCodeSchema,
  ProblemDocument,
  refusal,
  toProblemDocument,
  unauthenticated,
  type ProblemCode,
  type Refusal,
} from './problem.js';

export {
  ACCESS_POINTS,
  ApprovalDecisionBody,
  ApprovalRevokeBody,
  DefectFlagBody,
  DefinitionApplyBody,
  FREE_FORM_FIELD_NAMES,
  findRoute,
  IntentBody,
  InterventionBody,
  KillSwitchBody,
  ReviewDecisionBody,
  ROUTES,
  TemporaryGrantBody,
  type AccessPoint,
  type AuthMode,
  type RouteSpec,
} from './routes.js';

export {
  ACCESS_POINT_SCOPES,
  handled,
  isAccessPointScope,
  refused,
  type AccessPointScope,
  type AllowList,
  type ApiDeps,
  type ApprovalPort,
  type BrowserSession,
  type CallerIdentity,
  type CliToken,
  type DefinitionPort,
  type EventSink,
  type HandlerResult,
  type InspectionPort,
  type IntentIntake,
  type InterventionPort,
  type KillSwitch,
  type ReviewPort,
  type SessionStore,
  type TokenStore,
} from './ports.js';

export {
  InMemoryAllowList,
  InMemoryApprovalPort,
  InMemoryDefinitionPort,
  InMemoryIntentIntake,
  InMemoryInspectionPort,
  InMemoryInterventionPort,
  InMemoryKillSwitch,
  InMemoryReviewPort,
  InMemorySessionStore,
  InMemoryTokenStore,
  RecordingEventSink,
  testClock,
  testIds,
  type FakeApproval,
} from './fakes.js';

export { registerRoutes } from './handlers/index.js';
