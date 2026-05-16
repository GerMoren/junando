import { createHash } from 'node:crypto';
import type { NormalizedAlert } from '@junando/core';
import type { LokiQueryResponse } from '../ports/loki-http-client.port.js';
import type { IngestRule } from '../config/ingest-config.schema.js';

// ---------------------------------------------------------------------------
// mapLokiResultToAlerts — pure function
// ---------------------------------------------------------------------------

/**
 * Map a Loki query response to an array of NormalizedAlert objects.
 *
 * One alert is produced per distinct `stream.service` label in the response.
 * Rule config is the authoritative source for constrained fields (alertType,
 * severity, endpointPath). Stream labels provide context only (service, level).
 *
 * @param rule - The matching ingest rule
 * @param response - Raw Loki query response
 * @param queryStartMs - Query window start, Unix milliseconds
 * @param nowMs - Current time, Unix milliseconds (used for fingerprint window bucket)
 */
export function mapLokiResultToAlerts(
  rule: IngestRule,
  response: LokiQueryResponse,
  queryStartMs: number,
  nowMs: number,
): NormalizedAlert[] {
  const streams = response.data.result;
  if (streams.length === 0) return [];

  const windowMs = rule.windowMs ?? 60_000;
  const windowBucketEnd = Math.ceil(nowMs / windowMs) * windowMs;
  const startsAt = new Date(queryStartMs).toISOString();

  return streams.map((stream) => {
    const service = stream.stream['service'] ?? rule.service;
    const level = stream.stream['level'] ?? 'unknown';

    const fingerprint = computeFingerprint(rule.name, service, windowBucketEnd);

    // first log line value
    const firstValue = stream.values[0];
    const logLine = firstValue?.[1] ?? '';

    // best-effort traceId extraction from JSON log line
    let traceId: string | undefined;
    try {
      const parsed = JSON.parse(logLine) as Record<string, unknown>;
      if (typeof parsed['traceId'] === 'string') {
        traceId = parsed['traceId'];
      }
    } catch {
      // not JSON — ignore
    }

    const alert: NormalizedAlert = {
      fingerprint,
      alertName: rule.name,
      status: 'firing',
      serviceName: service,
      alertType: rule.alertType,
      endpointPath: rule.endpointPath ?? '',
      startsAt,
      labels: { service, level },
      annotations: { message: logLine },
      ...(traceId !== undefined ? { traceId } : {}),
    };

    return alert;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeFingerprint(ruleName: string, service: string, windowBucketEnd: number): string {
  const input = `${ruleName}:${service}:${windowBucketEnd}`;
  return createHash('sha256').update(input).digest('hex');
}
