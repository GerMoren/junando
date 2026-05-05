import type { AlertmanagerPayload, NormalizedAlert } from '../../domain/entities/alert.js'

// ─────────────────────────────────────────────────────────────────────────────
// normalizePayload()
// Maps the raw Alertmanager webhook payload → domain NormalizedAlert[].
// This is the anti-corruption layer: external format never leaks into domain.
// If Alertmanager changes its payload shape, only this file needs updating.
// ─────────────────────────────────────────────────────────────────────────────

export function normalizePayload(payload: AlertmanagerPayload): NormalizedAlert[] {
  return payload.alerts
    .filter((a) => a.status === 'firing') // ignore resolved alerts in MVP
    .map((a): NormalizedAlert => ({
      alertName:    a.labels['alertname'] ?? 'unknown',
      status:       a.status,
      serviceName:  a.labels['service'] ?? a.labels['job'] ?? 'unknown-service',
      errorType:    a.labels['error_type'] ?? a.labels['alertname'] ?? 'unknown-error',
      endpointPath: a.labels['endpoint'] ?? a.annotations['endpoint'] ?? '/',
      traceId:      a.labels['trace_id'] ?? a.annotations['trace_id'],
      startsAt:     a.startsAt,
      latencyMs:    a.labels['latency_ms'] ? Number(a.labels['latency_ms']) : undefined,
      labels:       a.labels,
      annotations:  a.annotations,
    }))
}
