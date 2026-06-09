---
name: no-switch-case
description: "Trigger: switch, case, switch/case, branching. NEVER use switch/case — use maps, registries, or composition instead."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Apply this skill whenever writing conditional branching logic in TypeScript/JavaScript. This is a global hard rule for the entire project — not limited to factories.

## Hard Rules

1. **NEVER use switch/case** — for any purpose, anywhere in the codebase
2. **Use object maps for static branching** — `{ key: value }` lookups are faster and tree-shakeable
3. **Use FactoryRegistry pattern for dynamic/parameterized branching** — register by string key, resolve by key
4. **Use if/else only for truly conditional logic** (2 branches max, non-dynamic)

## Decision Gates

| Situation | Use Instead |
|-----------|-------------|
| Static key→value mapping | Plain object: `const MAP = { a: A, b: B } as const` |
| Config-based adapter selection | FactoryRegistry: `registry.resolve(config.key)` |
| Multiple conditions (2+) | Early return + map, or extract to predicate functions |
| Conditional with side effects | if/else (acceptable here) |

## Map Pattern (static branching)

```typescript
// BAD
switch (alertType) {
  case 'error': return AlertType.Error;
  case 'warning': return AlertType.Warning;
  default: return AlertType.Success;
}

// GOOD
const ALERT_TYPE_MAP = {
  error: AlertType.Error,
  warning: AlertType.Warning,
  critical: AlertType.Error,
} as const;

const result = ALERT_TYPE_MAP[alertType] ?? AlertType.Success;
```

## Registry Pattern (dynamic branching)

```typescript
// BAD
function createNotifier(config: Config): INotifier {
  switch (config.notifierType) {
    case 'teams': return new TeamsNotifier(config.teamsWebhookUrl);
    case 'slack': return new SlackNotifier(config.slackBotToken);
    default: return new ConsoleNotifier();
  }
}

// GOOD
const registry = new FactoryRegistry<INotifier>();
registry.register('teams', () => new TeamsNotifier(config.teamsWebhookUrl));
registry.register('slack', () => new SlackNotifier(config.slackBotToken));
registry.registerDefault(() => new ConsoleNotifier());
return registry.resolve(config.notifierType);
```

## Execution Steps

1. When writing branching logic, first ask: can this be a static map?
2. If keys are dynamic/config-driven, use FactoryRegistry
3. If the branching is for control flow (not mapping), use if/else
4. Never reach for switch — it is always replaceable

## Output Contract

Return confirmation that switch/case was avoided and which pattern was used instead.

## References

- `assets/factory-registry.ts` — generic registry implementation
- `assets/map-pattern.ts` — examples of static map patterns