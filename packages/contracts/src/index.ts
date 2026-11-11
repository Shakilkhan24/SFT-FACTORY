/**
 * `contracts` — the contract source of truth (A1 §4.1: TypeScript profile
 * uses Zod → JSON Schema).
 *
 * pack 02 §3: "contracts imports nothing internal". This package depends on
 * no other `@factory/*` package and never on I/O.
 *
 * Every external input is parsed into a validated type at the boundary only
 * (AGENTS.md §4) and `.strict()` rejects unknown fields.
 *
 * **What is here.** pack 03 §3 (the core TypeScript contracts), §4 (the
 * definition document kinds), §5 (the event vocabulary), §6 (the state
 * machine tables) and §7 (the enumerations). Each section is one module;
 * this file is the index.
 *
 * **What is not here.** The `PolicyBundle` schema lives in `./policy.ts`
 * because the policy engine (T-1.05) and the bundle share the deny-rule
 * condition shape.
 */

import { z } from 'zod';

export { z };

export * from './shared.js';
export * from './event-log.js';
export * from './state.js';
export * from './policy.js';
export * from './context.js';
export * from './services.js';
export * from './definitions.js';
export * from './json-schema.js';
export * from './schema-registry.js';
export * from './export.js';
