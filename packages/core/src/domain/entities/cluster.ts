import { z } from 'zod';
import { AlertType } from '../../shared/constants.js';

/**
 * Severity level enum values — defined inline to avoid circular dependency
 * (cluster.ts → rule.ts → incident.ts → cluster.ts).
 * Must stay in sync with SeverityLevel in domain/entities/rule.ts.
 */
const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;

export const AlertClusterSchema = z.object({
  fingerprint: z.string(),
  serviceName: z.string(),
  alertType: z.nativeEnum(AlertType), // typed, not raw string
  endpointPath: z.string(),
  alertCount: z.number().int().positive(),
  representativeTraceIds: z.array(z.string()).max(2),
  firstSeenAt: z.string().datetime(),
  latencyP99Ms: z.number().optional(),
  /** Severity level — can be derived from ALERT_TYPE_LABELS[alertType].severity */
  severity: z.enum(SEVERITY_VALUES).optional(),
  /** Arbitrary key-value labels passed through from alerts */
  labels: z.record(z.string()).optional(),
});

export type AlertCluster = z.infer<typeof AlertClusterSchema>;
