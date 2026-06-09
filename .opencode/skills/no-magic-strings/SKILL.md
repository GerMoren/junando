---
name: no-magic-strings
description: "Trigger: hardcoded, magic string, magic number, repeated string, enum me. Replace repeated string/number literals with enums or constants — single source of truth."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Apply this skill whenever:
- Writing string/number literals that appear 2+ times in code
- Defining type discriminators or action variants
- Creating configuration schemas (Zod, etc.)
- Any constant value that could be reused

## Hard Rules

1. **Extract to enum** — Any string/number that appears 2+ times becomes an enum member
2. **Single source of truth** — Enum defined once, used everywhere
3. **Zod schemas reference enum** — Use `z.nativeEnum(Enum)` instead of `z.literal('value')` for repeated values
4. **Export enums from the same file as the type that uses them** — Keep related concepts together

## Decision Gates

| Situation | Action |
|-----------|--------|
| String/number appears 1x | Leave as literal — not worth the indirection |
| String/number appears 2+ times | Create enum immediately |
| Discriminated union action types | Always use enum (not just string literal) |
| Zod schema for action types | Use `z.nativeEnum(ActionType)` not `z.literal()` |
| Magic numbers (timeouts, limits) | Extract to named constant or config object |

## Examples

### Before (magic strings repeated)

```typescript
type Action = { type: 'suppress' } | { type: 'route'; channel: string };

const SUPPRESS = z.object({ type: z.literal('suppress') });
const ROUTE = z.object({ type: z.literal('route'), channel: z.string() });

// Later in code:
if (action.type === 'suppress') { ... }
```

### After (enum + single source of truth)

```typescript
export enum RuleActionType {
  Suppress = 'suppress',
  Route = 'route',
  Escalate = 'escalate',
  Tag = 'tag',
}

export type RuleAction =
  | { type: RuleActionType.Suppress }
  | { type: RuleActionType.Route; channel: string };

const SUPPRESS_SCHEMA = z.object({ type: z.literal(RuleActionType.Suppress) });
const ROUTE_SCHEMA = z.object({ type: z.literal(RuleActionType.Route), channel: z.string() });

// Later in code:
if (action.type === RuleActionType.Suppress) { ... }
```

### Zod schema with enum

```typescript
// Before
z.object({ severity: z.string().optional() }); // any string

// After
export enum SeverityLevel {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}
z.object({ severity: z.nativeEnum(SeverityLevel).optional() }); // validated
```

## Execution Steps

1. Scan for repeated string/number literals in the file being edited
2. If found 2+, create enum at top of file
3. Replace all occurrences with enum reference
4. Update Zod schemas to use `z.nativeEnum(Enum)` instead of `z.literal()`
5. Run lint and tests to verify

## Output Contract

Return confirmation that magic strings were extracted and list of enums created.