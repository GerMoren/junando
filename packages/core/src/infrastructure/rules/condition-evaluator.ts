import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../domain/entities/incident.js';
import type { ValidatedRuleCondition } from '../../domain/entities/rule.js';
import { ALERT_TYPE_LABELS } from '../../shared/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// ConditionEvaluator — compile RuleCondition → predicate function.
// No switch/case — uses Record<string, matcher> pattern.
// ─────────────────────────────────────────────────────────────────────────────

type Predicate = (cluster: AlertCluster, analysis?: LLMAnalysis) => boolean;

type MatcherFactory = (value: unknown) => Predicate;

/**
 * Map of condition field names to matcher factories.
 * Each factory takes the condition value and returns a predicate function.
 * This is the Record<string, matcher> pattern — no switch/case.
 */
const MATCHER_MAP: Record<string, MatcherFactory> = {
  serviceName: (value) => {
    const target = (value as string).toLowerCase();
    return (cluster) => cluster.serviceName.toLowerCase() === target;
  },

  alertType: (value) => {
    return (cluster) => cluster.alertType === value;
  },

  severity: (value) => {
    return (cluster) => {
      const config = ALERT_TYPE_LABELS[cluster.alertType];
      return config?.severity === value;
    };
  },

  endpointPath: (value) => {
    return (cluster) => cluster.endpointPath === value;
  },

  alertCount: (value) => {
    const range = value as { min?: number; max?: number };
    return (cluster) => {
      const count = cluster.alertCount;
      if (range.min !== undefined && count < range.min) return false;
      if (range.max !== undefined && count > range.max) return false;
      return true;
    };
  },

  latencyP99Ms: (value) => {
    const range = value as { min?: number; max?: number };
    return (cluster) => {
      const latency = cluster.latencyP99Ms;
      if (latency === undefined) return false;
      if (range.min !== undefined && latency < range.min) return false;
      if (range.max !== undefined && latency > range.max) return false;
      return true;
    };
  },

  labels: (value) => {
    const expected = value as Record<string, string>;
    return (cluster) => {
      // AlertCluster doesn't have labels yet — if condition specifies labels, match fails
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clusterLabels = (cluster as any).labels as Record<string, string> | undefined;
      if (!clusterLabels) return false;
      return Object.entries(expected).every(
        ([key, val]) => clusterLabels[key] === val,
      );
    };
  },

  urgencyLevel: (value) => {
    return (_cluster, analysis) => {
      if (!analysis) return false;
      return analysis.urgency_level === value;
    };
  },

  requiresRollback: (value) => {
    return (_cluster, analysis) => {
      if (!analysis) return false;
      return analysis.requires_rollback === value;
    };
  },

  impactedServices: (value) => {
    const targets = value as string[];
    return (_cluster, analysis) => {
      if (!analysis) return false;
      return targets.some((t) => analysis.impacted_services.includes(t));
    };
  },
};

/**
 * Compile a RuleCondition into a predicate function.
 * The returned function can be called with (cluster, analysis?) to evaluate the condition.
 * Pre-compilation ensures the field iteration and matcher assembly happen once at load time.
 *
 * All specified conditions must match (AND logic).
 * If no fields are specified, the predicate returns true (match-all).
 */
export function compileCondition(condition: ValidatedRuleCondition): Predicate {
  const predicates: Predicate[] = [];

  for (const [field, value] of Object.entries(condition)) {
    if (value === undefined) continue;

    const factory = MATCHER_MAP[field];
    if (factory) {
      predicates.push(factory(value));
    }
  }

  // If no conditions specified, match everything (pass-through)
  if (predicates.length === 0) {
    return () => true;
  }

  // AND logic: all predicates must pass
  return (cluster, analysis) => predicates.every((p) => p(cluster, analysis));
}
