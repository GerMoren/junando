import type { AlertmanagerPayload, NormalizedAlert } from '../../domain/entities/alert.js';
import { AlertType } from '../../shared/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// normalizePayload()
// Maps the raw Alertmanager webhook payload → domain NormalizedAlert[].
// This is the anti-corruption layer: external format never leaks into domain.
// If Alertmanager changes its payload shape, only this file needs updating.
// ─────────────────────────────────────────────────────────────────────────────

const ERROR_TYPE_TO_ALERT_TYPE: Record<string, AlertType> = {
  http_500: AlertType.Error,
  latency_spike: AlertType.Warning,
  recovery: AlertType.Success,
};

function toAlertType(raw: string): AlertType {
  return ERROR_TYPE_TO_ALERT_TYPE[raw] ?? AlertType.Error;
}

export function normalizePayload(payload: AlertmanagerPayload): NormalizedAlert[] {
  return payload.alerts
    .filter((a) => a.status === 'firing') // ignore resolved alerts in MVP
    .map(
      (a): NormalizedAlert => ({
        fingerprint:
          a.fingerprint ?? `${a.labels['alertname']}-${a.labels['service']}-${Date.now()}`,
        alertName: a.labels['alertname'] ?? 'unknown',
        status: a.status,
        serviceName: a.labels['service'] ?? a.labels['job'] ?? 'unknown-service',
        alertType: toAlertType(a.labels['error_type'] ?? a.labels['alertname'] ?? ''),
        endpointPath: a.labels['endpoint'] ?? a.annotations['endpoint'] ?? '/',
        traceId: a.labels['trace_id'] ?? a.annotations['trace_id'],
        startsAt: a.startsAt,
        latencyMs: a.labels['latency_ms'] ? Number(a.labels['latency_ms']) : undefined,
        labels: a.labels,
        annotations: a.annotations,
      }),
    );
}
