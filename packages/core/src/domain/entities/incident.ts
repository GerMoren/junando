import { z } from 'zod';
import { AlertClusterSchema } from './cluster.js';

export const UrgencyLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

// Strict JSON schema the LLM MUST return. Validated with Zod after parsing.
export const LLMAnalysisSchema = z.object({
  probable_cause: z.string().min(1),
  impacted_services: z.array(z.string()).min(1),
  recommended_steps: z.array(z.string()).min(1).max(5),
  urgency_level: UrgencyLevelSchema,
  requires_rollback: z.boolean(),
});

export const IncidentSchema = z.object({
  cluster: AlertClusterSchema,
  traces: z.array(z.record(z.unknown())).optional(),
  analysis: LLMAnalysisSchema.optional(), // absent if LLM failed gracefully
  processedAt: z.string().datetime(),
});

export type UrgencyLevel = z.infer<typeof UrgencyLevelSchema>;
export type LLMAnalysis = z.infer<typeof LLMAnalysisSchema>;
export type Incident = z.infer<typeof IncidentSchema>;
