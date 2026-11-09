/**
 * An in-memory {@link StateMachineStore}.
 *
 * The state machine is **pure** (pack 02 §3), so it can be driven without a
 * database. This store is the in-memory implementation of the interface: it
 * keeps the task row, takes the row lock (as a promise chain, so concurrent
 * transitions serialise the way `SELECT … FOR UPDATE` serialises them), and
 * records the events.
 *
 * The point is not convenience — it is that the property tests can assert on
 * the machine's behaviour without a Postgres container, and therefore run
 * everywhere the unit tests run.
 */

import type { EventEnvelope, NewEvent, TaskState } from '../../packages/contracts/src/index.ts';
import type {
  LockedTaskContext,
  StateMachineStore,
} from '../../packages/state/src/index.ts';

/**
 * A task in the in-memory store.
 */
export interface MemoryTask {
  readonly id: string;
  state: TaskState;
  version: number;
  autonomyLevel: number;
}

/**
 * The in-memory store.
 */
export class MemoryStateMachineStore implements StateMachineStore {
  /** The tasks, by id. */
  public readonly tasks = new Map<string, MemoryTask>();

  /** Every event appended, in order. */
  public readonly events: EventEnvelope[] = [];

  /** The refusal events, appended outside the transition transaction. */
  public readonly refusals: EventEnvelope[] = [];

  /**
   * The lock chain.
   *
   * Each transition holds the tail of this promise while it runs, so a
   * second transition of the same task waits — the in-memory equivalent of
   * `SELECT … FOR UPDATE`.
   */
  private lock: Promise<unknown> = Promise.resolve();

  /** The number of events appended, per aggregate. */
  public eventCountFor(taskId: string): number {
    return this.events.filter(
      (event) => event.aggregate.kind === 'task' && event.aggregate.id === taskId,
    ).length;
  }

  /** Add a task. */
  public addTask(task: MemoryTask): void {
    this.tasks.set(task.id, { ...task });
  }

  /**
   * Run `body` with the task row locked.
   */
  public async withLockedTask<T>(
    taskId: string,
    body: (context: LockedTaskContext) => Promise<T>,
  ): Promise<T> {
    const run = this.lock.then(async () => {
      const task = this.tasks.get(taskId);
      if (task === undefined) {
        throw new Error(`task ${taskId} does not exist`);
      }

      const context: LockedTaskContext = {
        state: task.state,
        version: task.version,
        autonomyLevel: task.autonomyLevel,

        updateState: (to: TaskState): Promise<void> => {
          const current = this.tasks.get(taskId);
          if (current === undefined) {
            return Promise.reject(new Error(`task ${taskId} does not exist`));
          }
          current.state = to;
          return Promise.resolve();
        },

        append: (
          events: readonly NewEvent[],
        ): Promise<readonly EventEnvelope[]> => {
          const current = this.tasks.get(taskId);
          if (current === undefined) {
            return Promise.reject(new Error(`task ${taskId} does not exist`));
          }
          // The event log owns the version bump, exactly as the Postgres
          // store does.
          current.version += 1;

          const envelopes = events.map((event) =>
            this.makeEnvelope(event, current.version),
          );
          this.events.push(...envelopes);
          return Promise.resolve(envelopes);
        },
      };

      return body(context);
    });

    // The chain continues even if this transition throws, so one failure
    // does not wedge the store.
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  /**
   * Append a refusal event.
   */
  public appendRefusal(events: readonly NewEvent[]): Promise<void> {
    for (const event of events) {
      this.refusals.push(this.makeEnvelope(event, 0));
    }
    return Promise.resolve();
  }

  /**
   * Build an envelope shaped like the event log's.
   */
  private makeEnvelope(event: NewEvent, version: number): EventEnvelope {
    return {
      eventId: `evt_${String(this.events.length + this.refusals.length + 1).padStart(6, '0')}`,
      seq: this.events.length + this.refusals.length + 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      eventType: event.eventType,
      schemaVersion: 1,
      aggregate: {
        kind: event.aggregate.kind,
        id: event.aggregate.id,
        version,
      },
      correlationId: event.correlationId,
      ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
      actor: event.actor,
      authority: event.authority,
      subject: event.subject,
      payload: event.payload,
      context: event.context,
      redaction: { applied: [], policyRef: 'test' },
      hash: `sha256:${'0'.repeat(64)}`,
    } as unknown as EventEnvelope;
  }
}
