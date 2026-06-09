import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../domain/entities/incident.js';
import type { IRuleEngine, RuleActionResult } from '../../domain/ports/index.js';
import type { ValidatedRule, ValidatedRuleConfiguration } from '../../domain/entities/rule.js';
import { RuleEvaluationPhase } from '../../domain/entities/rule.js';
import { compileCondition } from './condition-evaluator.js';
import { dispatchActions } from './action-dispatcher.js';

// ─────────────────────────────────────────────────────────────────────────────
// RuleEngine — implements IRuleEngine with first-match-wins evaluation.
// Pre-compiles all rule conditions at construction time for hot-path performance.
// No switch/case — delegates to compileCondition (Record<string, matcher>)
// and dispatchActions (Record<RuleActionType, handler>).
// ─────────────────────────────────────────────────────────────────────────────

interface CompiledRule {
  id: string;
  predicate: (cluster: AlertCluster, analysis?: LLMAnalysis) => boolean;
  result: ReturnType<typeof dispatchActions>;
}

export class RuleEngine implements IRuleEngine {
  private readonly preLlmRules: CompiledRule[];
  private readonly postLlmRules: CompiledRule[];

  constructor(config: ValidatedRuleConfiguration) {
    this.preLlmRules = this.compileSection(config[RuleEvaluationPhase.PreLlm].rules);
    this.postLlmRules = this.compileSection(config[RuleEvaluationPhase.PostLlm].rules);
  }

  /**
   * Evaluate PRE-LLM rules against a cluster.
   * First-match-wins — returns result of first matching rule.
   * If no rule matches, returns pass-through (suppressed=false, no actions).
   */
  evaluatePreLlm(cluster: AlertCluster): RuleActionResult {
    return this.evaluateRules(this.preLlmRules, cluster);
  }

  /**
   * Evaluate POST-LLM rules against a cluster and LLM analysis.
   * First-match-wins — returns result of first matching rule.
   * If no rule matches, returns pass-through.
   */
  evaluatePostLlm(
    cluster: AlertCluster,
    analysis: LLMAnalysis,
  ): RuleActionResult {
    return this.evaluateRules(this.postLlmRules, cluster, analysis);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private compileSection(rules: ValidatedRule[]): CompiledRule[] {
    return rules.map((rule) => ({
      id: rule.id,
      predicate: compileCondition(rule.condition),
      result: dispatchActions(rule.actions),
    }));
  }

  private evaluateRules(
    rules: CompiledRule[],
    cluster: AlertCluster,
    analysis?: LLMAnalysis,
  ): RuleActionResult {
    for (const rule of rules) {
      if (rule.predicate(cluster, analysis)) {
        return {
          ...rule.result,
          matchedRuleId: rule.id,
        };
      }
    }

    // No rule matched — pass-through
    return {
      suppressed: false,
      actions: [],
      tags: {},
    };
  }
}
