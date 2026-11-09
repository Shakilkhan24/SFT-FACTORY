/**
 * The `PolicyEngine` implementation.
 *
 * pack 03 §3: `export interface PolicyEngine { evaluate(input: PolicyInput,
 * bundle: PolicyBundle): Decision }` — "PURE, total, fail-closed".
 *
 * The interface takes only the input and the bundle. The engine also needs
 * the resolved grants and the capability's required autonomy level, which it
 * cannot derive itself (deriving them would mean reading the definition, and
 * the engine is pure).
 *
 * The class therefore holds those as **constructor state** — the caller
 * resolves them once and passes them in. The two-argument `evaluate` from
 * the contract is therefore exactly the contract's signature, and the extra
 * context is fixed at construction.
 *
 * This is the shape the broker and the transition guards use: build the
 * engine for the action's workflow and stage, then evaluate.
 */

import type { Decision, PolicyBundle, PolicyEngine, PolicyInput } from '@factory/contracts';

import { evaluate, type PolicyEvaluationContext } from './engine.js';

/**
 * A policy engine bound to one workflow and stage's context.
 */
export class DefaultPolicyEngine implements PolicyEngine {
  private readonly context: PolicyEvaluationContext;

  /**
   * @param context the resolved grants and facts for the action's workflow
   *   and stage. These are fixed for the engine's lifetime because the
   *   engine is bound to one workflow and stage.
   */
  constructor(context: PolicyEvaluationContext = {}) {
    this.context = context;
  }

  /**
   * Evaluate an action. Never throws.
   */
  public evaluate(input: PolicyInput, bundle: PolicyBundle): Decision {
    return evaluate(input, bundle, this.context);
  }
}

/**
 * The engine's type, as the contract declares it.
 *
 * Exposed so a caller can accept either the class or a plain function.
 */
export type PolicyEngineImplementation = PolicyEngine;
