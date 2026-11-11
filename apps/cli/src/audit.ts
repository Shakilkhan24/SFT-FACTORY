/**
 * `cli` — `factory audit chain <taskId>`.
 *
 * ## What the ticket asks for
 *
 * The ticket names it literally: "**`audit chain <taskId>`** (which runs
 * `EventLog.verifyChain`)". So the command verifies one aggregate's
 * hash chain and reports the verdict.
 *
 * ## The exit code is the point
 *
 * The oracle row: "`factory audit chain` exits 0 on an intact run and ≠0
 * on a tampered one."
 *
 * So the exit code is **0** for an intact chain and **1** for a broken
 * one. It is not 2 — 2 is the CLI's "you invoked me wrongly", and a
 * tampered chain is not an invocation error. A script that checks the
 * exit code must be able to tell "the chain is broken" from "I typed it
 * wrong".
 *
 * ## The port, and why there are two implementations
 *
 * `PostgresEventLog.verifyChain` needs a database, and this environment
 * has **no Docker daemon** — so the Postgres-backed test **skips** here
 * and runs in CI.
 *
 * But the *detection* logic is **pure**: `verifyChainLinks` in
 * `@factory/eventlog` takes the links and compares. `PostgresEventLog
 * .verifyChain` is a thin adapter — it SELECTs the rows and calls it. So
 * the in-memory verifier exercises the same function the Postgres one
 * does, and the tamper logic is proven without a database.
 *
 * The in-memory verifier is **not** a re-implementation. It builds the
 * links with the exported `chainHash` — the same function the log uses
 * to write them — so an intact chain really is intact and a tampered
 * one really is detectable. A verifier that used its own hashing would
 * be testing its own arithmetic.
 */

import {
  chainHash,
  verifyChainLinks,
  type ChainLink,
  type ChainVerificationResult,
} from '@factory/eventlog';

/**
 * The outcome of verifying one chain.
 *
 * This is the **richer** shape than `contracts`' `ChainVerification`:
 * the contract carries `ok` and `brokenAtSeq`, and this adds the count
 * and the reason — which the CLI prints, because "chain: BROKEN" without
 * "at seq 41: hash mismatch" leaves the operator to go and find out.
 */
export interface ChainVerdict {
  /** `true` when the chain is intact. */
  readonly ok: boolean;
  /** The `seq` of the first broken link. */
  readonly brokenAtSeq?: number | undefined;
  /** How many links were checked. */
  readonly checked: number;
  /** Why it broke. */
  readonly reason?: string | undefined;
}

/**
 * The port: something that can verify an aggregate's chain.
 */
export interface ChainVerifier {
  /**
   * Verify the chain of one aggregate.
   *
   * @param aggregate the aggregate's kind and id
   */
  verify(aggregate: { readonly kind: string; readonly id: string }): Promise<ChainVerdict>;
}

/**
 * The result of one command.
 */
export interface AuditResult {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

/**
 * An envelope, as the in-memory verifier stores it.
 */
export interface InMemoryLink {
  readonly seq: number;
  readonly envelope: Readonly<Record<string, unknown>>;
  /** The stored hash — the tamper target. */
  readonly hash: string;
  /** The stored previous hash. */
  readonly prevHash: string | null;
}

/**
 * Build the links for an aggregate from its envelopes.
 *
 * The links are built with the log's **own** `chainHash`, so an intact
 * aggregate verifies and a tampered one does not. The stored hashes are
 * kept separately so a test can alter one.
 */
export const buildLinks = (
  events: readonly {
    readonly seq: number;
    readonly envelope: Readonly<Record<string, unknown>>;
  }[],
): readonly InMemoryLink[] => {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const links: InMemoryLink[] = [];
  let previous: string | null = null;
  for (const event of ordered) {
    // `chainHash` returns the bare 64-hex form — the same form the log
    // stores in its `prev_hash` column once it is byte-encoded. The
    // verifier normalises both sides, so the bare form is what it wants.
    const hash = chainHash(event.envelope, previous);
    links.push({
      seq: event.seq,
      envelope: event.envelope,
      hash,
      prevHash: previous,
    });
    previous = hash;
  }
  return links;
};

/**
 * The in-memory verifier.
 *
 * It holds the links it was built with and verifies them with the log's
 * pure `verifyChainLinks`. A link whose stored hash was altered fails —
 * and so does every link after it, because the previous hash no longer
 * matches.
 */
export class InMemoryChainVerifier implements ChainVerifier {
  private readonly links: readonly ChainLink[];

  /**
   * @param events the aggregate's events, in any order
   */
  constructor(
    events: readonly {
      readonly seq: number;
      readonly envelope: Readonly<Record<string, unknown>>;
    }[],
  ) {
    this.links = buildLinks(events).map((link) => ({
      seq: link.seq,
      prevHash: link.prevHash,
      hash: link.hash,
      envelope: link.envelope,
    }));
  }

  /**
   * Verify the chain.
   *
   * The aggregate's id is not used — the verifier holds one aggregate's
   * links. The parameter is there so the port is the same shape as the
   * Postgres one, and so a caller cannot forget that it is verifying
   * *something*.
   */
  public verify(_aggregate: { readonly kind: string; readonly id: string }): Promise<ChainVerdict> {
    const result: ChainVerificationResult = verifyChainLinks(this.links);
    return Promise.resolve({
      ok: result.ok,
      checked: result.checked,
      ...(result.brokenAtSeq === undefined ? {} : { brokenAtSeq: result.brokenAtSeq }),
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    });
  }
}

/**
 * The lines a verdict becomes.
 */
export const verdictLines = (
  aggregate: { readonly kind: string; readonly id: string },
  verdict: ChainVerdict,
): readonly string[] => {
  const lines: string[] = [];
  lines.push(
    verdict.ok
      ? `chain: intact (${String(verdict.checked)} links checked)`
      : verdict.brokenAtSeq === undefined
        ? 'chain: NOTHING TO VERIFY'
        : `chain: BROKEN at seq ${String(verdict.brokenAtSeq)}`,
  );
  lines.push(`  aggregate: ${aggregate.kind}:${aggregate.id}`);
  lines.push(`  links:     ${String(verdict.checked)}`);
  if (verdict.reason !== undefined) {
    lines.push(`  reason:    ${verdict.reason}`);
  }
  return lines;
};

/**
 * The verifier backed by the real log.
 *
 * It wraps `PostgresEventLog.verifyChainDetailed` — which is a SELECT
 * followed by a call to the same pure `verifyChainLinks` the in-memory
 * verifier uses. So the two implementations differ only in **where the
 * links come from**, not in how a break is detected.
 *
 * ## Why the **detailed** method
 *
 * Because the count matters. `contracts`' `ChainVerification` carries
 * `ok` and `brokenAtSeq` and is `.strict()` — the contract is unchanged
 * (HR-12) — so the count cannot ride on `verifyChain`. It comes from
 * the concrete class's `verifyChainDetailed`, which runs the same pure
 * verifier and additionally reports how many links it checked.
 */
export class PostgresChainVerifier implements ChainVerifier {
  private readonly log: {
    verifyChainDetailed(aggregate: { kind: string; id: string }): Promise<{
      readonly ok: boolean;
      readonly brokenAtSeq?: number | undefined;
      readonly checked?: number | undefined;
      readonly reason?: string | undefined;
    }>;
  };

  /**
   * @param log the log to verify against
   */
  constructor(
    log: {
      verifyChainDetailed(aggregate: { kind: string; id: string }): Promise<{
        readonly ok: boolean;
        readonly brokenAtSeq?: number | undefined;
        readonly checked?: number | undefined;
        readonly reason?: string | undefined;
      }>;
    },
  ) {
    this.log = log;
  }

  /**
   * Verify the chain.
   */
  public async verify(aggregate: {
    readonly kind: string;
    readonly id: string;
  }): Promise<ChainVerdict> {
    const result = await this.log.verifyChainDetailed({
      kind: aggregate.kind,
      id: aggregate.id,
    });
    const checked = result.checked ?? 0;
    return {
      ok: result.ok,
      checked,
      ...(result.brokenAtSeq === undefined ? {} : { brokenAtSeq: result.brokenAtSeq }),
      ...(result.ok
        ? {}
        : {
            reason:
              result.brokenAtSeq === undefined
                ? 'the chain does not verify'
                : `the chain does not verify from seq ${String(result.brokenAtSeq)}`,
          }),
    };
  }
}

/**
 * The reason an **empty** chain is not a pass.
 *
 * An aggregate with no events has a trivially intact chain: every link
 * (there are none) recomputes. So `verifyChainLinks` says `ok: true` for
 * a chain with nothing in it — which is correct as a *statement about
 * the links* and wrong as an *audit verdict*.
 *
 * The audit's question is "was this run's history verified?", and the
 * answer for a run that wrote no events is **no**. So the empty case is
 * reported as a failure with its own reason, distinct from a broken
 * chain — an operator reading the output can tell "there was nothing to
 * verify" from "the history was tampered with".
 */
export const EMPTY_CHAIN_REASON =
  'the aggregate has no events, so there was no chain to verify';

/**
 * Run `factory audit chain <taskId>`.
 *
 * @param taskId the task whose chain to verify
 * @param verifier the port that does the verifying
 */
export const runAuditChain = async (
  taskId: string | undefined,
  verifier: ChainVerifier,
): Promise<AuditResult> => {
  if (taskId === undefined || taskId === '') {
    return {
      lines: ['usage: factory audit chain <taskId>'],
      exitCode: 2,
    };
  }

  const aggregate = { kind: 'task', id: taskId };
  const verdict = await verifier.verify(aggregate);

  // An **empty** chain is not a pass. The links verify trivially (there
  // are none), so `verdict.ok` is true — but "there was nothing to
  // verify" is not "the history was verified", and an audit that cannot
  // tell the two apart is worse than no audit.
  const empty = verdict.checked === 0;
  const reported: ChainVerdict = empty
    ? {
        ok: false,
        checked: 0,
        reason: EMPTY_CHAIN_REASON,
      }
    : verdict;

  return {
    lines: verdictLines(aggregate, reported),
    // 0 for an intact chain, 1 for a broken one. Not 2 — 2 means the
    // command was invoked wrongly, and a tampered chain is not that.
    exitCode: reported.ok ? 0 : 1,
  };
};
