import { z } from 'zod';
import { AlertType } from '../../shared/constants.js';
import { UrgencyLevelSchema } from './incident.js';

// ─────────────────────────────────────────────────────────────────────────────
// Enums — single source of truth for repeated values
// ─────────────────────────────────────────────────────────────────────────────

export enum RuleActionType {
  Suppress = 'suppress',
  Route = 'route',
  Escalate = 'escalate',
  Tag = 'tag',
}

export enum SeverityLevel {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

/** Rule evaluation points in the pipeline */
export enum RuleEvaluationPhase {
  PreLlm = 'pre-llm',
  PostLlm = 'post-llm',
}

// ─────────────────────────────────────────────────────────────────────────────
// RuleCondition — what can be matched in a rule
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleCondition {
  serviceName?: string;
  alertType?: AlertType;
  severity?: SeverityLevel;
  labels?: Record<string, string>;
  endpointPath?: string;
  alertCount?: { min?: number; max?: number };
  latencyP99Ms?: { min?: number; max?: number };
  /** POST-LLM only (analysis must be present) */
  urgencyLevel?: z.infer<typeof UrgencyLevelSchema>;
  requiresRollback?: boolean;
  impactedServices?: string[];
}

const AlertCountSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
});

const LatencySchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
});

export const RuleConditionSchema = z.object({
  serviceName: z.string().optional(),
  alertType: z.nativeEnum(AlertType).optional(),
  severity: z.nativeEnum(SeverityLevel).optional(),
  labels: z.record(z.string()).optional(),
  endpointPath: z.string().optional(),
  alertCount: AlertCountSchema.optional(),
  latencyP99Ms: LatencySchema.optional(),
  urgencyLevel: UrgencyLevelSchema.optional(),
  requiresRollback: z.boolean().optional(),
  impactedServices: z.array(z.string()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// RuleAction — discriminated union
// ─────────────────────────────────────────────────────────────────────────────

export type RuleAction =
  | { type: RuleActionType.Suppress }
  | { type: RuleActionType.Route; channel: string }
  | { type: RuleActionType.Escalate; channel: string }
  | { type: RuleActionType.Tag; key: string; value: string };

const SUPPRESS_SCHEMA = z.object({ type: z.literal(RuleActionType.Suppress) });
const ROUTE_SCHEMA = z.object({ type: z.literal(RuleActionType.Route), channel: z.string().min(1) });
const ESCALATE_SCHEMA = z.object({ type: z.literal(RuleActionType.Escalate), channel: z.string().min(1) });
const TAG_SCHEMA = z.object({ type: z.literal(RuleActionType.Tag), key: z.string().min(1), value: z.string().min(1) });

export const RuleActionSchema = z.discriminatedUnion('type', [
  SUPPRESS_SCHEMA,
  ROUTE_SCHEMA,
  ESCALATE_SCHEMA,
  TAG_SCHEMA,
]);

// ─────────────────────────────────────────────────────────────────────────────
// Rule — single rule definition
// ─────────────────────────────────────────────────────────────────────────────

export interface Rule {
  id: string;
  name?: string;
  condition: RuleCondition;
  actions: RuleAction[];
  /** POST-LLM only (can only be used in post-llm section) */
  urgencyLevel?: z.infer<typeof UrgencyLevelSchema>;
  requiresRollback?: boolean;
}

export const RuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  condition: RuleConditionSchema,
  actions: z.array(RuleActionSchema).min(1),
  urgencyLevel: UrgencyLevelSchema.optional(),
  requiresRollback: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// RuleSection — pre-llm or post-llm rules
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleSection {
  rules: Rule[];
}

export const RuleSectionSchema = z.object({
  rules: z.array(RuleSchema).default([]),
});

// ─────────────────────────────────────────────────────────────────────────────
// RuleConfiguration — full YAML shape
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleConfiguration {
  [RuleEvaluationPhase.PreLlm]: RuleSection;
  [RuleEvaluationPhase.PostLlm]: RuleSection;
}

export const RuleConfigurationSchema = z.object({
  [RuleEvaluationPhase.PreLlm]: RuleSectionSchema,
  [RuleEvaluationPhase.PostLlm]: RuleSectionSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Validated types (from Zod schemas)
// ─────────────────────────────────────────────────────────────────────────────

export type ValidatedRuleCondition = z.infer<typeof RuleConditionSchema>;
export type ValidatedRuleAction = z.infer<typeof RuleActionSchema>;
export type ValidatedRule = z.infer<typeof RuleSchema>;
export type ValidatedRuleSection = z.infer<typeof RuleSectionSchema>;
export type ValidatedRuleConfiguration = z.infer<typeof RuleConfigurationSchema>;
