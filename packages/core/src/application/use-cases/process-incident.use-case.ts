import type { NormalizedAlert } from '../../domain/entities/alert.js';
import type {
  IDeduplicationStore,
  ILLMProvider,
  INotifier,
  IRuleEngine,
  ITraceRepository,
} from '../../domain/ports/index.js';
import { ClusteringService } from '../../domain/services/clustering.service.js';
import type { Logger } from '../../shared/logger/index.js';
import { dedupNew, dedupDuplicate, suppressedClusters } from '../../shared/metrics/index.js';

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
  ruleEngine?: IRuleEngine;
}

export class ProcessIncidentUseCase {
  private readonly clustering: ClusteringService;

  constructor(private readonly deps: Dependencies) {
    this.clustering = deps.clustering ?? new ClusteringService();
  }

  async execute(alerts: NormalizedAlert[], correlationId: string): Promise<void> {
    const { dedup, traces, llm, notifier, logger, dedupTtlSeconds, ruleEngine } = this.deps;
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

      // 3. PRE-LLM rule engine hook — evaluate rules before LLM
      // ────────────────────────────────────────────────────────────────────
      let preLlmRouteChannels: string[] = [];
      let preLlmEscalateChannels: string[] = [];

      if (ruleEngine) {
        const preResult = ruleEngine.evaluatePreLlm(cluster);

        if (preResult.suppressed) {
          log2.info({ matchedRuleId: preResult.matchedRuleId }, 'Cluster suppressed by rule engine');
          if (preResult.matchedRuleId) {
            suppressedClusters.inc({ rule_id: preResult.matchedRuleId });
          }
          continue; // Skip LLM, traces, and notification entirely
        }

        // Collect route and escalate channels from PRE-LLM actions
        for (const action of preResult.actions) {
          if (action.type === 'route' && 'channel' in action) {
            preLlmRouteChannels.push(action.channel);
          }
          if (action.type === 'escalate' && 'channel' in action) {
            preLlmEscalateChannels.push(action.channel);
          }
        }
      }

      // 4. Extract representative traces from the trace repository
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

      // 5. LLM inference — fail gracefully, notify anyway with null analysis
      let analysis = null;
      try {
        analysis = await llm.analyze(cluster, allSpans);
        log2.info({ urgency: analysis.urgency_level }, 'LLM analysis complete');
      } catch (err) {
        log2.warn({ err }, 'LLM inference failed — notifying without diagnosis');
      }

      // 6. POST-LLM rule engine hook — evaluate rules after LLM analysis
      // ────────────────────────────────────────────────────────────────────
      let postLlmEscalateChannels: string[] = [];

      if (ruleEngine && analysis) {
        const postResult = ruleEngine.evaluatePostLlm(cluster, analysis);

        // Collect escalate channels from POST-LLM actions
        for (const action of postResult.actions) {
          if (action.type === 'escalate' && 'channel' in action) {
            postLlmEscalateChannels.push(action.channel);
          }
          // Tag actions: attach metadata to cluster for observability
          if (action.type === 'tag' && 'key' in action) {
            log2.info({ tagKey: action.key, tagValue: (action as { value: string }).value }, 'Tag attached to cluster');
          }
        }

        // Apply tags from postResult to cluster
        if (postResult.tags && Object.keys(postResult.tags).length > 0) {
          cluster.labels = { ...cluster.labels, ...postResult.tags };
        }
      }

      // 7. Notify via ChatOps — with rule-based routing
      // ────────────────────────────────────────────────────────────────────
      try {
        const primaryChannel = preLlmRouteChannels[0]; // First route wins
        const escalateChannels = [
          ...preLlmEscalateChannels,
          ...postLlmEscalateChannels,
        ];

        // Send primary notification (to route channel or default)
        await notifier.send(cluster, analysis, primaryChannel);

        // Send escalation notifications (in addition to primary)
        for (const channel of escalateChannels) {
          await notifier.send(cluster, analysis, channel);
        }

        log2.info('Notification sent');
      } catch (err) {
        log2.error({ err }, 'Notification failed');
        throw err; // let the worker retry via SQS
      }
    }
  }
}
