import type { NormalizedAlert } from '../entities/alert.js'
import type { AlertCluster } from '../entities/cluster.js'
import { Fingerprint } from '../value-objects/fingerprint.js'

// ─────────────────────────────────────────────────────────────────────────────
// ClusteringService — Domain Service.
// Pure business logic. No I/O, no external deps.
// Groups alerts and selects representative samples.
// ─────────────────────────────────────────────────────────────────────────────

export class ClusteringService {

  /**
   * Groups alerts by fingerprint and builds AlertCluster objects.
   * 300 alerts with the same root cause → 1 cluster with 2 representative traces.
   */
  buildClusters(alerts: NormalizedAlert[]): AlertCluster[] {
    const groups = new Map<string, NormalizedAlert[]>()

    for (const alert of alerts) {
      const fp = Fingerprint.fromAlert(alert).toString()
      const group = groups.get(fp) ?? []
      group.push(alert)
      groups.set(fp, group)
    }

    return Array.from(groups.entries()).map(([fp, group]) =>
      this.buildCluster(fp, group),
    )
  }

  private buildCluster(fingerprint: string, alerts: NormalizedAlert[]): AlertCluster {
    const sorted = [...alerts].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )

    const first = sorted[0]!
    const traceIds = this.sampleTraceIds(alerts)
    const latencies = alerts.map((a) => a.latencyMs ?? 0)
    const p99 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)]

    return {
      fingerprint,
      serviceName:            first.serviceName,
      errorType:              first.errorType,
      endpointPath:           first.endpointPath,
      alertCount:             alerts.length,
      representativeTraceIds: traceIds,
      firstSeenAt:            first.startsAt,
      latencyP99Ms:           p99,
    }
  }

  private sampleTraceIds(alerts: NormalizedAlert[]): string[] {
    const withTraces = alerts.filter(
      (a): a is NormalizedAlert & { traceId: string } =>
        typeof a.traceId === 'string' && a.traceId.length > 0,
    )
    if (withTraces.length === 0) return []

    const sorted = [...withTraces].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )
    const first = sorted[0]!
    const slowest = withTraces.reduce((max, a) =>
      (a.latencyMs ?? 0) > (max.latencyMs ?? 0) ? a : max,
    )

    return slowest.traceId !== first.traceId
      ? [first.traceId, slowest.traceId]
      : [first.traceId]
  }
}
