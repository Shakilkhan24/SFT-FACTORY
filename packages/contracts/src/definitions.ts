/**
 * Definition-document contracts — pack 03 §4.1–§4.11.
 *
 * Every definition document carries `apiVersion: factory/v1` and a `kind`.
 * pack 03 §1 (Versioning row): "Every YAML/JSON document carries `apiVersion:
 * factory/v1` and `kind`. Unknown kinds/fields are **rejected** (`.strict()`)."
 *
 * The YAML examples in pack `03` §4 are the **examples of record**: the
 * contract test for T-1.01 parses every one of them. A schema that does not
 * accept the pack's own example is wrong.
 */

import { z } from 'zod';

import {
  Autonomy,
  EffectClass,
  ExecutorKind,
  ROLE_NAMES,
  STAGE_KINDS,
  Tier,
  UsdMicros,
} from './shared.js';
import type { StageKind } from './shared.js';
import { PolicyBundle } from './policy.js';

/** The apiVersion every definition document carries (pack 03 §1). */
export const API_VERSION = 'factory/v1';

/** The definition kinds (pack 03 §4). */
export const DEFINITION_KINDS = [
  'FactoryDefinition',
  'WorkflowDefinition',
  'RoleSpec',
  'ToolCapability',
  'CapabilityGrant',
  'WorkflowEnvironment',
  'RoutingPolicy',
  'PolicyBundle',
  'CriticalityMap',
  'RepoOnboarding',
  'AcceptanceOracle',
  'TaskGraph',
] as const;

export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

/** A document's identity block. */
const Metadata = z
  .object({
    name: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    oracleId: z.string().min(1).optional(),
  })
  .strict();

/** A `$ref` to a schema file in `/schemas`. */
const SchemaRef = z
  .object({
    $ref: z.string().min(1),
  })
  .strict();

/**
 * A workflow's stage (pack 03 §4.2).
 *
 * ```yaml
 * - { id: triage,   kind: specify,      role: triage,     executor: completion, model: triage }
 * - { id: implement, kind: implement,   role: worker,     executor: harness,    model: worker, isolation: T2 }
 * - { id: approve-plan, kind: approve,  approval: plan }
 * ```
 */
export const WorkflowStage = z
  .object({
    id: z.string().min(1),
    kind: z.enum(STAGE_KINDS),
    role: z.enum(ROLE_NAMES).optional(),
    executor: ExecutorKind.optional(),
    model: z.string().min(1).optional(),
    whenRoute: z.enum(['human', 'generated', 'agent']).optional(),
    approval: z.enum(['plan', 'merge', 'definition', 'temporary-grant']).optional(),
    isolation: z.enum(['T1', 'T2']).optional(),
    requireDifferentModel: z.boolean().optional(),
  })
  .strict();

export type WorkflowStage = z.infer<typeof WorkflowStage>;

/**
 * `FactoryDefinition` — `definition/factory.yaml` (pack 03 §4.1).
 */
export const FactoryDefinition = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('FactoryDefinition'),
    metadata: Metadata,
    spec: z
      .object({
        owner: z
          .object({
            githubLogin: z.string().min(1),
          })
          .strict(),
        global: z
          .object({
            maxConcurrentTasks: z.number().int().positive().optional(),
            killSwitch: z
              .object({
                honour: z.boolean(),
              })
              .strict()
              .optional(),
            dailyBudgetUsdMicros: UsdMicros.optional(),
          })
          .strict(),
        defaults: z
          .object({
            autonomyLevel: Autonomy.optional(),
            gateRetryBudget: z.number().int().nonnegative().optional(),
            taskBudgetUsdMicros: UsdMicros.optional(),
          })
          .strict()
          .optional(),
        repos: z
          .array(
            z
              .object({
                ref: z.string().min(1),
              })
              .strict(),
          )
          .default([]),
        workflows: z.array(z.string().min(1)).default([]),
      })
      .strict(),
  })
  .strict();

export type FactoryDefinition = z.infer<typeof FactoryDefinition>;

/**
 * `WorkflowDefinition` (pack 03 §4.2) — slimmed from
 * `blueprint-reference/templates/WORKFLOW.md`.
 */
export const WorkflowDefinition = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('WorkflowDefinition'),
    metadata: z
      .object({
        name: z.string().min(1),
      })
      .strict(),
    spec: z
      .object({
        autonomy: z
          .object({
            level: Autonomy,
            ceiling: Autonomy,
          })
          .strict(),
        trigger: z
          .object({
            kind: z.enum(['event', 'manual', 'schedule']),
            source: z.string().min(1).optional(),
            event: z.string().min(1).optional(),
            label: z.string().min(1).optional(),
            /**
             * The pack's own example writes a single entry — `requesterAllowList:
             * owner` — so a bare string is accepted alongside a list. The
             * pack is the example of record; the contract must accept it.
             */
            requesterAllowList: z
              .union([z.string().min(1), z.array(z.string().min(1))])
              .optional(),
          })
          .strict(),
        planApproval: z.enum(['required', 'not_required']).optional(),
        stages: z.array(WorkflowStage).default([]),
        limits: z
          .object({
            maxConcurrent: z.number().int().positive().optional(),
            reworkLoops: z.number().int().nonnegative().optional(),
            maxWallClockSeconds: z.number().int().positive().optional(),
            maxUsdMicrosPerTask: UsdMicros.optional(),
          })
          .strict()
          .optional(),
        completion: z.array(z.string().min(1)).default([]),
      })
      .strict(),
  })
  .strict();

export type WorkflowDefinition = z.infer<typeof WorkflowDefinition>;

/**
 * `RoleSpec` (pack 03 §4.3, blueprint 08 §8).
 */
export const RoleSpec = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('RoleSpec'),
    metadata: z
      .object({
        name: z.string().min(1),
      })
      .strict(),
    spec: z
      .object({
        responsibility: z.string(),
        contextScope: z
          .object({
            include: z.array(z.string().min(1)).default([]),
            exclude: z.array(z.string().min(1)).default([]),
          })
          .strict(),
        toolScope: z
          .object({
            grant: z.array(z.string().min(1)).default([]),
            deny: z.array(z.string().min(1)).default([]),
          })
          .strict(),
        modelPolicy: z
          .object({
            class: z.string().min(1),
            fallbacks: z.array(z.string().min(1)).default([]),
          })
          .strict(),
        limits: z
          .object({
            turns: z.number().int().nonnegative().optional(),
            wallClockSeconds: z.number().int().positive().optional(),
            costBudgetUsdMicros: UsdMicros.optional(),
            contextBudgetBytes: z.number().int().nonnegative().optional(),
          })
          .strict(),
        autonomy: z
          .object({
            maxLevel: Autonomy,
          })
          .strict(),
        spawning: z
          .object({
            allowed: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type RoleSpec = z.infer<typeof RoleSpec>;

/**
 * `ToolCapability` (pack 03 §4.4, blueprint 11 §2.1).
 */
export const ToolCapabilityDefinition = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('ToolCapability'),
    metadata: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
      })
      .strict(),
    spec: z
      .object({
        owner: z.string().min(1),
        kind: z.enum(['read', 'mutation', 'compute', 'communicate']),
        transport: z.enum(['inproc', 'http', 'cli', 'mcp', 'library']),
        effect: z
          .object({
            class: EffectClass,
            reversible: z.boolean(),
            undo: z.string().min(1).optional(),
            external: z.boolean(),
          })
          .strict(),
        scope: z
          .object({
            required: z.array(z.string().min(1)),
            resourcePattern: z.string().min(1),
            environment: z.string().min(1),
          })
          .strict(),
        credentials: z
          .object({
            provider: z.string().min(1),
            permissions: z.record(z.enum(['read', 'write'])),
            ttlSeconds: z.number().int().positive(),
          })
          .strict(),
        inputSchema: SchemaRef.optional(),
        outputSchema: SchemaRef.optional(),
        trust: z
          .object({
            inputTrust: z.enum(['trusted', 'untrusted']),
            resultTrust: z.enum(['trusted', 'untrusted']),
          })
          .strict(),
        health: z
          .object({
            check: z.string().min(1),
            timeoutMs: z.number().int().positive(),
            degraded: z.string().min(1),
          })
          .strict(),
        observability: z
          .object({
            redactArguments: z.array(z.string()),
          })
          .strict(),
        cost: z
          .object({
            unit: z.string().min(1),
            usdMicros: UsdMicros,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type ToolCapabilityDefinition = z.infer<typeof ToolCapabilityDefinition>;

/**
 * `CapabilityGrant` (pack 03 §4.5).
 */
export const CapabilityGrant = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('CapabilityGrant'),
    metadata: z
      .object({
        name: z.string().min(1),
      })
      .strict(),
    spec: z
      .object({
        workflow: z.string().min(1),
        stage: z.string().min(1),
        allow: z.array(z.string().min(1)).default([]),
        resourceScope: z
          .object({
            repo: z.string().optional(),
            paths: z
              .object({
                writeGlobs: z.array(z.string()).default([]),
                denyGlobs: z.array(z.string()).default([]),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        deny: z.array(z.string().min(1)).default([]),
      })
      .strict(),
  })
  .strict();

export type CapabilityGrant = z.infer<typeof CapabilityGrant>;

/**
 * `WorkflowEnvironment` (pack 03 §4.5).
 */
export const WorkflowEnvironment = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('WorkflowEnvironment'),
    metadata: z
      .object({
        name: z.string().min(1),
      })
      .strict(),
    spec: z
      .object({
        isolation: z.enum(['T1', 'T2']),
        image: z.string().min(1),
        network: z
          .object({
            egress: z.array(z.string().min(1)).default([]),
          })
          .strict()
          .optional(),
        resources: z
          .object({
            cpus: z.number().int().positive().optional(),
            memoryMb: z.number().int().positive().optional(),
            pids: z.number().int().positive().optional(),
            wallClockSeconds: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export type WorkflowEnvironment = z.infer<typeof WorkflowEnvironment>;

/**
 * `RoutingPolicy` (pack 03 §4.6, blueprint 11 §9.3).
 */
export const RoutingPolicy = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('RoutingPolicy'),
    metadata: Metadata.optional(),
    spec: z
      .object({
        providers: z.record(
          z
            .object({
              adapter: z.string().min(1),
            })
            .strict(),
        ),
        classes: z.record(
          z
            .object({
              primary: z
                .object({
                  provider: z.string().min(1),
                  model: z.string().min(1),
                })
                .strict(),
              fallbacks: z
                .array(
                  z
                    .object({
                      provider: z.string().min(1),
                      model: z.string().min(1),
                    })
                    .strict(),
                )
                .default([]),
            })
            .strict(),
        ),
        rules: z
          .array(
            z
              .object({
                match: z
                  .object({
                    role: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
                    stage: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
                  })
                  .strict(),
                use: z.string().min(1),
              })
              .strict(),
          )
          .default([]),
        reviewerIndependence: z
          .object({
            requireDifferentRunAndContext: z.boolean().optional(),
            preferDifferentModelFromWorker: z.boolean().optional(),
          })
          .strict()
          .optional(),
        budgets: z
          .object({
            perRequestUsdMicros: UsdMicros.optional(),
            perTaskUsdMicros: UsdMicros.optional(),
            perWorkflowDayUsdMicros: UsdMicros.optional(),
          })
          .strict()
          .optional(),
        failover: z
          .object({
            on: z.array(z.string().min(1)).default([]),
            neverOn: z.array(z.string().min(1)).default([]),
          })
          .strict()
          .optional(),
        caching: z
          .object({
            prefix: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export type RoutingPolicy = z.infer<typeof RoutingPolicy>;

/**
 * `CriticalityMap` (pack 03 §4.8, blueprint 13 §5.5).
 */
export const CriticalityMap = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('CriticalityMap'),
    metadata: z
      .object({
        repo: z.string().min(1).optional(),
      })
      .strict(),
    spec: z
      .object({
        paths: z
          .array(
            z
              .object({
                glob: z.string().min(1),
                tier: Tier,
                reason: z.string().min(1),
              })
              .strict(),
          )
          .default([]),
        default: Tier,
        dataClasses: z
          .array(
            z
              .object({
                glob: z.string().min(1),
                class: z.string().min(1),
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),
  })
  .strict();

export type CriticalityMap = z.infer<typeof CriticalityMap>;

/**
 * `RepoOnboarding` (pack 03 §4.9) — `<target-repo>/.factory/repo.yml`.
 */
export const RepoOnboarding = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('RepoOnboarding'),
    metadata: Metadata.optional(),
    spec: z
      .object({
        repo: z.string().min(1),
        defaultBranch: z.string().min(1),
        language: z.string().min(1),
        image: z.string().min(1),
        commands: z
          .object({
            install: z.array(z.string().min(1)).optional(),
            static: z.array(z.string().min(1)).optional(),
            typecheck: z.array(z.string().min(1)).optional(),
            test: z.array(z.string().min(1)).optional(),
            oracle: z.array(z.string().min(1)).optional(),
            securityScan: z
              .array(z.array(z.string().min(1)))
              .optional(),
          })
          .strict(),
        oracle: z
          .object({
            paths: z.array(z.string().min(1)).default([]),
            generatorKinds: z.array(z.string().min(1)).default([]),
          })
          .strict(),
        paths: z
          .object({
            src: z.array(z.string()).default([]),
            tests: z.array(z.string()).default([]),
            publicInterface: z.array(z.string()).default([]),
            migrations: z.array(z.string()).default([]),
            security: z.array(z.string()).default([]),
            docs: z.array(z.string()).default([]),
          })
          .strict(),
        docs: z
          .object({
            requiredWhenTag: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
        context: z
          .object({
            files: z.array(z.string().min(1)).default([]),
          })
          .strict()
          .optional(),
        ci: z
          .object({
            requiredChecks: z.array(z.string().min(1)).default([]),
            provider: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export type RepoOnboarding = z.infer<typeof RepoOnboarding>;

/**
 * `AcceptanceOracle` manifest (pack 03 §4.10, blueprint 14 §3.1).
 */
export const AcceptanceOracle = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('AcceptanceOracle'),
    metadata: z
      .object({
        oracleId: z.string().min(1),
        taskId: z.string().min(1),
      })
      .strict(),
    spec: z
      .object({
        route: z.enum(['human', 'generated', 'agent']),
        provenance: z
          .object({
            author: z.string().min(1),
            implementationRunId: z.string().min(1).nullable(),
            createdAt: z.string().min(1),
            generator: z.string().min(1).optional(),
            commitSha: z.string().min(1).optional(),
          })
          .strict(),
        criteria: z
          .array(
            z
              .object({
                id: z.string().min(1),
                statement: z.string().min(1),
                tags: z.array(z.string().min(1)).default([]),
                checks: z
                  .array(
                    z
                      .object({
                        id: z.string().min(1),
                        kind: z.enum(['command-check', 'behavior-table', 'file-assertion']),
                        files: z.array(z.string().min(1)).optional(),
                        argv: z.array(z.string().min(1)).optional(),
                        expectedBefore: z.enum(['pass', 'fail']),
                        visibility: z.enum(['visible', 'holdout']),
                      })
                      .strict(),
                  )
                  .default([]),
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),
  })
  .strict();

export type AcceptanceOracle = z.infer<typeof AcceptanceOracle>;

/**
 * `TaskGraph` (pack 03 §4.11, the v1 subset of blueprint 09 §7).
 */
export const TaskGraph = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal('TaskGraph'),
    metadata: z
      .object({
        taskId: z.string().min(1),
      })
      .strict(),
    spec: z
      .object({
        nodes: z
          .array(
            z
              .object({
                id: z.string().min(1),
                kind: z.enum(STAGE_KINDS),
                role: z.string().min(1).optional(),
                oracleRef: z.string().min(1).optional(),
                capabilities: z.array(z.string().min(1)).default([]),
                budget: z
                  .object({
                    usdMicros: UsdMicros,
                    turns: z.number().int().nonnegative().optional(),
                  })
                  .strict()
                  .optional(),
              })
              .strict(),
          )
          .default([]),
        edges: z
          .array(
            z
              .object({
                from: z.string().min(1),
                to: z.string().min(1),
                classification: z.enum(['independent', 'dependent']),
                justification: z.string().min(1),
              })
              .strict(),
          )
          .default([]),
        topology: z.enum(['single', 'sequential', 'fan-out']),
        integrationOrder: z.array(z.string().min(1)).default([]),
      })
      .strict(),
  })
  .strict();

export type TaskGraph = z.infer<typeof TaskGraph>;

/**
 * Every definition schema, keyed by kind.
 *
 * A document is parsed by looking up its `kind` and parsing with that
 * schema. An unknown kind is rejected (pack 03 §1: "Unknown kinds/fields are
 * **rejected**").
 */
export const DEFINITION_SCHEMAS = {
  FactoryDefinition,
  WorkflowDefinition,
  RoleSpec,
  ToolCapability: ToolCapabilityDefinition,
  CapabilityGrant,
  WorkflowEnvironment,
  RoutingPolicy,
  PolicyBundle,
  CriticalityMap,
  RepoOnboarding,
  AcceptanceOracle,
  TaskGraph,
} as const;

/**
 * The kind of a parsed definition document.
 */
export const DefinitionDocument = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.enum(DEFINITION_KINDS),
  })
  .passthrough();

export type DefinitionDocument = z.infer<typeof DefinitionDocument>;

/**
 * The stage kinds a v1 workflow may declare.
 *
 * Re-exported so a workflow document can be checked against the same
 * vocabulary the contracts use.
 */
export const V1_STAGE_KIND_LIST: readonly StageKind[] = STAGE_KINDS.filter(
  (kind) => kind !== 'deploy' && kind !== 'investigate',
);
