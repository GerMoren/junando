import { describe, it, expect } from 'vitest';
import { RuleActionType } from '../../../domain/entities/rule.js';
import type { RuleAction } from '../../../domain/entities/rule.js';

// Import the function under test — does NOT exist yet (RED)
import { dispatchActions } from '../action-dispatcher.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: RED phase — tests written FIRST. action-dispatcher.ts does NOT exist yet.
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchActions', () => {
  it('returns empty result for empty actions array', () => {
    const result = dispatchActions([]);
    expect(result).toEqual({
      suppressed: false,
      actions: [],
      matchedRuleId: undefined,
      tags: {},
    });
  });

  it('handles Suppress action — sets suppressed flag', () => {
    const actions: RuleAction[] = [{ type: RuleActionType.Suppress }];
    const result = dispatchActions(actions);
    expect(result.suppressed).toBe(true);
    expect(result.actions).toHaveLength(0);
    expect(result.tags).toEqual({});
  });

  it('handles Route action — records channel in actions', () => {
    const actions: RuleAction[] = [
      { type: RuleActionType.Route, channel: 'slack-sre' },
    ];
    const result = dispatchActions(actions);
    expect(result.suppressed).toBe(false);
    expect(result.actions).toEqual([{ type: RuleActionType.Route, channel: 'slack-sre' }]);
    expect(result.tags).toEqual({});
  });

  it('handles Escalate action — records channel in actions', () => {
    const actions: RuleAction[] = [
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ];
    const result = dispatchActions(actions);
    expect(result.suppressed).toBe(false);
    expect(result.actions).toEqual([
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ]);
    expect(result.tags).toEqual({});
  });

  it('handles Tag action — accumulates tags', () => {
    const actions: RuleAction[] = [
      { type: RuleActionType.Tag, key: 'team', value: 'payments' },
    ];
    const result = dispatchActions(actions);
    expect(result.suppressed).toBe(false);
    expect(result.actions).toHaveLength(0);
    expect(result.tags).toEqual({ team: 'payments' });
  });

  it('handles multiple Tag actions — merges all tags', () => {
    const actions: RuleAction[] = [
      { type: RuleActionType.Tag, key: 'team', value: 'dba' },
      { type: RuleActionType.Tag, key: 'incident-class', value: 'rollback-required' },
      { type: RuleActionType.Tag, key: 'priority', value: 'p0' },
    ];
    const result = dispatchActions(actions);
    expect(result.tags).toEqual({
      team: 'dba',
      'incident-class': 'rollback-required',
      priority: 'p0',
    });
  });

  it('handles Suppress + Route actions together', () => {
    const actions: RuleAction[] = [
      { type: RuleActionType.Suppress },
      { type: RuleActionType.Route, channel: 'slack-sre' },
    ];
    const result = dispatchActions(actions);
    expect(result.suppressed).toBe(true);
    expect(result.actions).toEqual([{ type: RuleActionType.Route, channel: 'slack-sre' }]);
  });

  it('handles Route + Escalate actions together', () => {
    const actions: RuleAction[] = [
      { type: RuleActionType.Route, channel: 'slack-sre' },
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ];
    const result = dispatchActions(actions);
    expect(result.suppressed).toBe(false);
    expect(result.actions).toEqual([
      { type: RuleActionType.Route, channel: 'slack-sre' },
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ]);
  });

  it('handles Suppress + Escalate + Tag actions together', () => {
    const actions: RuleAction[] = [
      { type: RuleActionType.Suppress },
      { type: RuleActionType.Escalate, channel: 'oncall' },
      { type: RuleActionType.Tag, key: 'source', value: 'rule-engine' },
    ];
    const result = dispatchActions(actions);
    expect(result.suppressed).toBe(true);
    expect(result.actions).toEqual([{ type: RuleActionType.Escalate, channel: 'oncall' }]);
    expect(result.tags).toEqual({ source: 'rule-engine' });
  });

  it('does NOT mutate input actions array', () => {
    const actions: RuleAction[] = [
      { type: RuleActionType.Tag, key: 'a', value: '1' },
    ];
    const snapshot = [...actions];
    dispatchActions(actions);
    expect(actions).toEqual(snapshot);
  });

  it('later Tag with same key overwrites earlier tag', () => {
    const actions: RuleAction[] = [
      { type: RuleActionType.Tag, key: 'team', value: 'alpha' },
      { type: RuleActionType.Tag, key: 'team', value: 'beta' },
    ];
    const result = dispatchActions(actions);
    expect(result.tags).toEqual({ team: 'beta' });
  });
});
