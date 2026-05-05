import { z } from 'zod'

export const AlertClusterSchema = z.object({
  fingerprint:               z.string(),
  serviceName:               z.string(),
  errorType:                 z.string(),
  endpointPath:              z.string(),
  alertCount:                z.number().int().positive(),
  representativeTraceIds:    z.array(z.string()).max(2),
  firstSeenAt:               z.string().datetime(),
  latencyP99Ms:              z.number().optional(),
})

export type AlertCluster = z.infer<typeof AlertClusterSchema>
