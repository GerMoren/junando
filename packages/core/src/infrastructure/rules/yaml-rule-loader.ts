import { parse as parseYaml, YAMLParseError } from 'yaml';
import { RuleConfigurationSchema } from '../../domain/entities/rule.js';
import type { ValidatedRuleConfiguration } from '../../domain/entities/rule.js';

// ─────────────────────────────────────────────────────────────────────────────
// YamlRuleLoader — reads rules.yaml, validates with Zod, returns RuleConfiguration.
// No switch/case. Pure validation function for testability.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate a YAML string into a RuleConfiguration.
 * Pure function — no I/O, no side effects. Fast-fails on invalid config.
 *
 * @throws {Error} if YAML is malformed or Zod validation fails
 */
export function parseRuleConfig(yamlString: string): ValidatedRuleConfiguration {
  let raw: unknown;
  try {
    raw = parseYaml(yamlString);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new Error(`Invalid YAML in rules config: ${err.message}`);
    }
    throw err;
  }

  const result = RuleConfigurationSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid rules configuration:\n${issues}`);
  }

  return result.data;
}
