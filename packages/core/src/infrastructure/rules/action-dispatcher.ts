import { RuleActionType } from '../../domain/entities/rule.js';
import type { RuleAction } from '../../domain/entities/rule.js';
import type { RuleActionResult } from '../../domain/ports/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// ActionDispatcher — dispatch RuleAction[] → RuleActionResult.
// No switch/case — uses Record<RuleActionType, handler> pattern.
// ─────────────────────────────────────────────────────────────────────────────

type ActionHandler = (action: RuleAction, result: RuleActionResult) => void;

/**
 * Map of action type to handler function.
 * Record<RuleActionType, handler> pattern — NO switch/case.
 * Each handler mutates the result object for the given action.
 */
const HANDLER_MAP: Record<string, ActionHandler> = {
  [RuleActionType.Suppress]: (_action, result) => {
    result.suppressed = true;
  },

  [RuleActionType.Route]: (action, result) => {
    result.actions.push(action);
  },

  [RuleActionType.Escalate]: (action, result) => {
    result.actions.push(action);
  },

  [RuleActionType.Tag]: (action, result) => {
    const tagAction = action as { type: RuleActionType.Tag; key: string; value: string };
    result.tags[tagAction.key] = tagAction.value;
  },
};

/**
 * Dispatch an array of RuleAction into a RuleActionResult.
 * All actions are processed in order.
 * The result accumulates: suppressed flag, route/escalate actions, and tags.
 *
 * Pure function — no I/O, no side effects beyond the returned result.
 */
export function dispatchActions(actions: RuleAction[]): RuleActionResult {
  const result: RuleActionResult = {
    suppressed: false,
    actions: [],
    tags: {},
  };

  for (const action of actions) {
    const handler = HANDLER_MAP[action.type];
    if (handler) {
      handler(action, result);
    }
  }

  return result;
}
