import type { NormalizedAlert } from '../../domain/entities/alert.js';
import type {
  IDeduplicationStore,
  ILLMProvider,
  INotifier,
  ITraceRepository,
} from '../../domain/ports/index.js';
import { ClusteringService } from '../../domain/services/clustering.service.js';
import type { Logger } from '../../shared/logger/index.js';
import { dedupNew, dedupDuplicate } from '../../shared/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// ProcessIncidentUseCase — Application layer.
// Orchestrates the full pipeline using only domain interfaces (ports).
// Never imports a concrete infrastructure class directly.
// ─────────────────────────────────────────────────────────────────────────────

interface Dependencies {
  dedup: IDeduplicationStore;
  traces: ITraceRepository;
  llm: ILLMProvider;
  notifier: INotifier;
  logger: Logger;
  dedupTtlSeconds: number;
  clustering?: ClusteringService;
  onClustersBuilt?: (count: number) => void;
}

export class ProcessIncidentUseCase {
  private readonly clustering: ClusteringService;

  constructor(private readonly deps: Dependencies) {
    this.clustering = deps.clustering ?? new ClusteringService();
  }

  async execute(alerts: NormalizedAlert[], correlationId: string): Promise<void> {
    const { dedup, traces, llm, notifier, logger, dedupTtlSeconds } = this.deps;
    const log = logger.child({ correlationId, useCase: 'ProcessIncident' });

    log.info({ alertCount: alerts.length }, 'Processing alert batch');

    // 1. Cluster alerts by fingerprint
    const clusters = this.clustering.buildClusters(alerts);
    log.info({ clusterCount: clusters.length }, 'Clusters built');
    this.deps.onClustersBuilt?.(clusters.length);

    for (const cluster of clusters) {
      const log2 = log.child({ fingerprint: cluster.fingerprint, service: cluster.serviceName });

      // 2. Deduplicate — skip if seen recently
      const isNew = await dedup.isNew(cluster.fingerprint, dedupTtlSeconds);
      if (!isNew) {
        log2.debug('Duplicate cluster — skipping');
        dedupDuplicate.inc({ source: 'alertmanager' });
        continue;
      }
      dedupNew.inc({ source: 'alertmanager' });

      // 3. Extract representative traces from the trace repository
      const spanLists = await Promise.all(
        cluster.representativeTraceIds.map((id) =>
          traces.findByTraceId(id).catch((err) => {
            log2.warn({ err, traceId: id }, 'Trace fetch failed — continuing without it');
            return [];
          }),
        ),
      );
      const allSpans = spanLists.flat();
      log2.info({ spanCount: allSpans.length }, 'Traces extracted');

      // 4. LLM inference — fail gracefully, notify anyway with null analysis
      let analysis = null;
      try {
        analysis = await llm.analyze(cluster, allSpans);
        log2.info({ urgency: analysis.urgency_level }, 'LLM analysis complete');
      } catch (err) {
        log2.warn({ err }, 'LLM inference failed — notifying without diagnosis');
      }

      // 5. Notify via ChatOps
      try {
        await notifier.send(cluster, analysis);
        log2.info('Notification sent');
      } catch (err) {
        log2.error({ err }, 'Notification failed');
        throw err; // let the worker retry via SQS
      }
    }
  }
}
