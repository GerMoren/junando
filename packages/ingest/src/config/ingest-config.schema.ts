import { AlertType } from '@junando/core';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

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

const SqsRuntimeSchema = z.object({
  queueUrl: z.string().url(),
  endpointUrl: z.string().url().optional(),
  waitTimeSeconds: z
    .number()
    .int()
    .min(1, 'waitTimeSeconds must be ≥ 1; this adapter requires long polling.')
    .max(20)
    .default(20),
  visibilityTimeoutSeconds: z.number().int().positive().default(60),
  batchSize: z.number().int().min(1).max(10).default(10),
  maxInFlight: z.number().int().positive().default(20),
});

const OpenSearchTargetSchema = z.object({
  endpoint: z.string().url(),
  indexName: z.string().min(1),
  region: z.string().min(1),
});

function ensureUniqueRuleNames(rules: IngestRule[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate rule name: "${rule.name}"`,
        path: ['rules'],
      });
      return;
    }
    seen.add(rule.name);
  }
}

const LokiIngestSectionSchema = z.object({
  kind: z.literal('loki'),
  intervalMs: z.number().int().positive().default(30_000),
  loki: LokiConfigSchema,
  rules: z.array(IngestRuleSchema).min(1),
});

const LegacyLokiIngestSectionSchema = z.object({
  intervalMs: z.number().int().positive().default(30_000),
  loki: LokiConfigSchema,
  rules: z.array(IngestRuleSchema).min(1),
});

const SqsMapperSchema = z.object({ kind: z.string().min(1) });

const SqsIngestSectionSchema = z.object({
  kind: z.literal('sqs'),
  sqs: SqsRuntimeSchema,
  opensearch: OpenSearchTargetSchema.optional(),
  mapper: SqsMapperSchema,
});

const ExplicitIngestSectionSchema = z.discriminatedUnion('kind', [
  LokiIngestSectionSchema,
  SqsIngestSectionSchema,
]);

const ExplicitIngestConfigSchema = z
  .object({
    ingest: ExplicitIngestSectionSchema,
  })
  .superRefine((data, ctx) => {
    if (data.ingest.kind === 'loki') {
      ensureUniqueRuleNames(data.ingest.rules, ctx);
    }
  });

const LegacyLokiIngestConfigSchema = z
  .object({
    ingest: LegacyLokiIngestSectionSchema,
  })
  .superRefine((data, ctx) => {
    ensureUniqueRuleNames(data.ingest.rules, ctx);
  });

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type IngestRule = z.infer<typeof IngestRuleSchema>;
export type LokiIngestSection = z.infer<typeof LokiIngestSectionSchema>;
export type SqsIngestSection = z.infer<typeof SqsIngestSectionSchema>;
export type OpenSearchTarget = z.infer<typeof OpenSearchTargetSchema>;
export type SqsMapper = z.infer<typeof SqsMapperSchema>;
export type LokiIngestConfig = { ingest: LokiIngestSection };
export type SqsIngestConfig = { ingest: SqsIngestSection };
export type IngestConfig = LokiIngestConfig | SqsIngestConfig;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeLegacyConfig(raw: unknown): unknown {
  const legacy = LegacyLokiIngestConfigSchema.safeParse(raw);
  if (!legacy.success) {
    return raw;
  }

  return {
    ingest: {
      kind: 'loki' as const,
      ...legacy.data.ingest,
    },
  };
}

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

  let raw: unknown;
  try {
    raw = parseYaml(yamlString);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML config: ${msg}`);
  }

  const normalized = normalizeLegacyConfig(raw);
  const result = ExplicitIngestConfigSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(`Invalid ingest config: ${result.error.message}`);
  }

  return Object.freeze(result.data) as IngestConfig;
}
