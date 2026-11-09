/**
 * `contracts` — the contract source of truth (A1 §4.1: TypeScript profile
 * uses Zod → JSON Schema).
 *
 * pack 02 §3: "contracts imports nothing internal". This package depends on
 * no other `@factory/*` package and never on I/O.
 *
 * Every external input is parsed into a validated type at the boundary only
 * (AGENTS.md §4) and `.strict()` rejects unknown fields.
 */

import { z } from 'zod';

export { z };

/** Money is integer micro-USD — never a bare float (AGENTS.md §4). */
export const UsdMicros = z.number().int().nonnegative();

/**
 * A git SHA — 40 lowercase hex characters.
 */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'expected a 64-char lowercase sha256 hex');

export const GitSha = z.string().regex(/^[0-9a-f]{40}$/, 'expected a 40-char lowercase git sha');

export const TicketId = z.string().regex(/^T-\d+\.\d{2}$/, 'expected a ticket id like T-0.01');

export const TaskId = z.string().min(1).max(128);

/** ISO-8601 instant, always UTC with a `Z` suffix. */
export const IsoInstant = z.string().datetime({ offset: true });

export const NonEmptyString = z.string().min(1);
