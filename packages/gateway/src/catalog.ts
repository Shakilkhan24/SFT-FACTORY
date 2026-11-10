/**
 * `gateway` — the startup models check.
 *
 * pack 02 §4.7: *"**Startup check:** call the provider's models list and
 * refuse routes naming unknown models `[VERIFY]`."*
 *
 * Decision 0023: *"names are examples and `[VERIFY]` against the
 * provider's current model list at startup; gateway refuses unknown
 * models."*
 *
 * ## Why a **check** and not a **filter**
 *
 * The tempting implementation is to filter the routing policy's
 * candidates down to the models a provider offers, and route to what
 * is left. That is the wrong shape, for two reasons.
 *
 * * **A filter silently changes the policy.** The operator wrote a
 *   primary and a fallback; a filter that drops the primary routes the
 *   work to the fallback — a *different model at a different price* —
 *   without anybody asking for it. The gateway would then be a
 *   different factory than the one the operator configured.
 * * **A filter cannot report.** The caller sees a successful answer
 *   from a model nobody chose. The refusal is the whole point: an
 *   unknown model is a **configuration gap**, and it must be loud.
 *
 * So the check **refuses**. A route naming a model the provider does
 * not offer is not usable, and the gateway says so instead of quietly
 * using a different model.
 *
 * ## Fail **closed**
 *
 * If the provider's `models()` call *fails*, the gateway does **not**
 * assume the model is present — "the list was unreachable" is not
 * "the list was empty" and it is certainly not "the model is fine".
 * The routes that depend on that provider are **unavailable**.
 *
 * The distinction matters because the two failures look the same to a
 * naive implementation: an empty list and a failed call both yield
 * "not found". Treating them the same would mean a provider outage
 * silently reclassified every route as an unknown-model gap, and the
 * operator would go looking in the wrong place.
 *
 * ## A placeholder is not a model
 *
 * The corpus's own routing policy carries `"<configured>"` as a model
 * id — an operator's placeholder for a model they have not filled in
 * yet. A placeholder is **not** an unknown model: it is a model the
 * operator has not named. The check reports it as *unconfigured*
 * rather than *unknown*, so the operator's first act is to fill it in
 * rather than to go hunting for a typo.
 */

import type { ProviderAdapter } from './ports.js';

/**
 * The state of one provider's model catalogue.
 *
 * - `known` — the provider listed its models; the ones it lists are
 *   present, the ones it does not are unknown.
 * - `unavailable` — the provider's list could not be read; **every**
 *   model it might have offered is unknown.
 */
export type CatalogState =
  | { readonly kind: 'known'; readonly models: readonly string[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * The result of checking one route's models.
 */
export type ModelCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly provider: string;
      readonly model: string;
      readonly reason: string;
      /**
       * Why the model is unusable.
       *
       * - `unknown` — the provider listed its models and this one is
       *   not among them.
       * - `unavailable` — the provider's list could not be read.
       * - `unconfigured` — the model id is a placeholder.
       */
      readonly kind: 'unknown' | 'unavailable' | 'unconfigured';
    };

/**
 * A model id that is a **placeholder**, not a model.
 *
 * The corpus's routing policy carries `"<configured>"` for a model the
 * operator has not named yet.
 */
export const isPlaceholder = (model: string): boolean =>
  model.startsWith('<') && model.endsWith('>');

/**
 * Read a provider's catalogue.
 *
 * The provider's own `models()` is the source of truth — the gateway
 * does not know how any provider lists its models.
 */
export const readCatalog = async (
  provider: ProviderAdapter,
): Promise<CatalogState> => {
  try {
    return { kind: 'known', models: await provider.models() };
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Check one model against a provider's catalogue.
 *
 * The order is deliberate: a placeholder is reported as
 * *unconfigured* even when the provider's list is unreadable, because
 * the placeholder is the operator's own to-do and it hides everything
 * else.
 */
export const checkModel = (
  provider: string,
  model: string,
  catalog: CatalogState,
): ModelCheck => {
  if (isPlaceholder(model)) {
    return {
      ok: false,
      provider,
      model,
      kind: 'unconfigured',
      reason: `the model "${model}" is a placeholder; the operator has not named a model for the provider "${provider}"`,
    };
  }

  if (catalog.kind === 'unavailable') {
    return {
      ok: false,
      provider,
      model,
      kind: 'unavailable',
      reason: `the provider "${provider}" could not list its models, so the model "${model}" cannot be confirmed: ${catalog.reason}`,
    };
  }

  if (!catalog.models.includes(model)) {
    return {
      ok: false,
      provider,
      model,
      kind: 'unknown',
      reason: `the provider "${provider}" does not offer the model "${model}"`,
    };
  }

  return { ok: true };
};

/**
 * Check every model the routing policy names.
 *
 * The result is a list, not a single answer: an operator needs to see
 * **every** gap at once, not the first one.
 */
export const checkPolicyModels = (
  policy: {
    readonly spec: {
      readonly classes: Readonly<
        Record<
          string,
          {
            readonly primary: { readonly provider: string; readonly model: string };
            readonly fallbacks: readonly {
              readonly provider: string;
              readonly model: string;
            }[];
          }
        >
      >;
    };
  },
  catalogs: Readonly<Record<string, CatalogState>>,
): readonly ModelCheck[] => {
  const problems: ModelCheck[] = [];

  for (const routeClass of Object.values(policy.spec.classes)) {
    const candidates = [routeClass.primary, ...routeClass.fallbacks];

    for (const candidate of candidates) {
      const catalog = catalogs[candidate.provider] ?? {
        kind: 'unavailable' as const,
        reason: `the provider "${candidate.provider}" is not configured`,
      };

      const check = checkModel(candidate.provider, candidate.model, catalog);
      if (!check.ok) {
        problems.push(check);
      }
    }
  }

  return problems;
};
