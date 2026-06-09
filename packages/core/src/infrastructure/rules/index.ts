// ─────────────────────────────────────────────────────────────────────────────
// Rules infrastructure — barrel export
// ─────────────────────────────────────────────────────────────────────────────

export { parseRuleConfig } from './yaml-rule-loader.js';
export { compileCondition } from './condition-evaluator.js';
export { dispatchActions } from './action-dispatcher.js';
export { ChannelRegistry } from './channel-registry.js';
export { RuleEngine } from './rule-engine.js';
