import { z } from 'zod';
import { AlertType } from '../../shared/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Alert — the core domain entity.
// Represents a single normalized alert from any source (Alertmanager, etc.)
// The domain doesn't care where it came from — only what it means.
// ─────────────────────────────────────────────────────────────────────────────

export const AlertStatusSchema = z.enum(['firing', 'resolved']);

export const NormalizedAlertSchema = z.object({
  fingerprint: z.string(),
  alertName: z.string(),
  status: AlertStatusSchema,
  serviceName: z.string(),
  alertType: z.nativeEnum(AlertType),
  endpointPath: z.string(),
  traceId: z.string().optional(),
  startsAt: z.string().datetime(),
  latencyMs: z.number().optional(),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()),
});

// Raw Alertmanager webhook payload — validated at the boundary (Lambda A)
// then normalized into NormalizedAlert before entering the domain.
export const AlertmanagerPayloadSchema = z.object({
  version: z.string().default('4'),
  groupKey: z.string(),
  truncatedAlerts: z.number().default(0),
  status: AlertStatusSchema,
  receiver: z.string(),
  groupLabels: z.record(z.string(), z.string()),
  commonLabels: z.record(z.string(), z.string()),
  commonAnnotations: z.record(z.string(), z.string()),
  externalURL: z.string().url(),
  alerts: z
    .array(
      z.object({
        status: AlertStatusSchema,
        labels: z.record(z.string(), z.string()),
        annotations: z.record(z.string(), z.string()).default({}),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        fingerprint: z.string().optional(),
      }),
    )
    .min(1),
});

export type AlertStatus = z.infer<typeof AlertStatusSchema>;
export type NormalizedAlert = z.infer<typeof NormalizedAlertSchema>;
export type AlertmanagerPayload = z.infer<typeof AlertmanagerPayloadSchema>;

// Backward-compat alias — errorType is now alertType
export type AlertErrorType = NormalizedAlert['alertType'];
