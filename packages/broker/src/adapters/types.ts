/**
 * The adapter types, shared by the five transports.
 *
 * ## Why these are not `ports.ts`'s `ToolAdapter`
 *
 * The port in `ports.ts` is what the **broker** holds. These are what the
 * **adapters** implement. They are structurally the same, but keeping the
 * adapter's own declaration here means the adapters do not import the
 * ports module — and the ports module does not import the adapters — so
 * there is no cycle between the broker's vocabulary and its transports.
 */

import type { ToolCapability } from '@factory/contracts';

/**
 * The capability's shape, as an adapter sees it.
 */
export type AdapterCapability = Pick<ToolCapability, 'id' | 'transport' | 'version'> & {
  readonly version: string;
};

/**
 * The adapter's shape.
 */
export interface ToolAdapterLike {
  /** The capabilities this adapter serves. */
  describe(): readonly AdapterCapability[];

  /**
   * Invoke a capability.
   *
   * @param token the factory's guard token. Only `factory.ts` can produce
   *   it, and `assertGuardToken` refuses anything else.
   */
  invoke(
    capabilityId: string,
    args: unknown,
    credential: unknown,
    signal: AbortSignal,
    token: symbol,
  ): Promise<unknown>;

  /** The adapter's health. */
  health(): Promise<'healthy' | 'degraded' | 'unavailable' | 'unknown'>;

  /** Release the adapter's resources. */
  close(): Promise<void>;
}
