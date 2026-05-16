import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { AlertType } from '@junando/core';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const LokiAuthSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bearer'),
    tokenEnv: z.string().min(1),
  }),
  z.object({
    type: z.literal('basic'),
    userEnv: z.string().min(1),
    passEnv: z.string().min(1),
  }),
]);

const IngestRuleSchema = z.object({
  name: z.string().min(1),
  query: z.string().min(1),
  service: z.string().min(1),
  alertType: z.nativeEnum(AlertType),
  severity: z.string().min(1),
  endpointPath: z.string().optional(),
  windowMs: z.number().int().positive().optional(),
});

const LokiConfigSchema = z.object({
  url: z
    .string()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().url()),
  timeoutMs: z.number().int().positive().default(10_000),
  auth: LokiAuthSchema.optional(),
});

const IngestSectionSchema = z
  .object({
    intervalMs: z.number().int().positive().default(30_000),
    loki: LokiConfigSchema,
    rules: z.array(IngestRuleSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const names = data.rules.map((r) => r.name);
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate rule name: "${name}"`,
          path: ['rules'],
        });
        return;
      }
      seen.add(name);
    }
  });

const IngestConfigSchema = z.object({
  ingest: IngestSectionSchema,
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type IngestConfig = z.infer<typeof IngestConfigSchema>;
export type IngestRule = z.infer<typeof IngestRuleSchema>;

// ---------------------------------------------------------------------------
// loadIngestConfig — parse YAML string and validate
// ---------------------------------------------------------------------------

/**
 * Parse and validate a YAML string into an IngestConfig.
 *
 * Throws on:
 * - empty/malformed YAML
 * - Zod validation errors (with descriptive messages)
 *
 * Returns a frozen top-level object (shallow).
 */
export function loadIngestConfig(yamlString: string): IngestConfig {
  if (!yamlString || yamlString.trim() === '') {
    throw new Error('Config YAML is empty. Provide a valid INGEST_CONFIG_PATH.');
  }

  // parse — throws on malformed YAML
  let raw: unknown;
  try {
    raw = parseYaml(yamlString);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML config: ${msg}`);
  }

  const result = IngestConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid ingest config: ${result.error.message}`);
  }

  return Object.freeze(result.data);
}
