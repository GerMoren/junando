import type { ProcessIncidentUseCase } from '@junando/core';
import type { PrometheusHttpClientPort } from '../ports/prometheus-http-client.port.js';
import type { PrometheusIngestConfig, PrometheusRule } from '../config/ingest-config.schema.js';
import { mapMetricResultToAlerts } from '../mapping/metric-to-alert.mapper.js';

// ---------------------------------------------------------------------------
// Logger interface — matches pino's shape without importing pino directly
// ---------------------------------------------------------------------------

interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// PrometheusIngestRunnerDeps
// ---------------------------------------------------------------------------

export interface PrometheusIngestRunnerDeps {
  config: PrometheusIngestConfig;
  promClient: PrometheusHttpClientPort;
  processIncidentUseCase: Pick<ProcessIncidentUseCase, 'execute'>;
  logger: Logger;
}

export interface PrometheusIngestRunnerOpts {
  /** Clock injection for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// PrometheusIngestRunner
// ---------------------------------------------------------------------------

/**
 * Polling loop that queries Prometheus on a fixed interval and forwards matches
 * to ProcessIncidentUseCase. Mirrors IngestRunner topology — no shared base class.
 *
 * Each tick fans out all configured rules concurrently via Promise.allSettled —
 * one rule failure never blocks others.
 *
 * Lagging rules (previous tick still in-flight) are skipped with a warning.
 * stop() drains all in-flight promises before resolving.
 *
 * Correlation ID format: `prometheus-{ruleIndex}-{timestamp}`
 */
export class PrometheusIngestRunner {
  private readonly config: PrometheusIngestConfig;
  private readonly promClient: PrometheusHttpClientPort;
  private readonly useCase: Pick<ProcessIncidentUseCase, 'execute'>;
  private readonly logger: Logger;
  private readonly now: () => number;

  /** Tracks in-flight per-rule promises to enable lagging-rule skip. */
  private readonly inFlightKeys = new Set<string>();
  private readonly inFlightPromises = new Map<string, Promise<void>>();

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(deps: PrometheusIngestRunnerDeps, opts: PrometheusIngestRunnerOpts = {}) {
    this.config = deps.config;
    this.promClient = deps.promClient;
    this.useCase = deps.processIncidentUseCase;
    this.logger = deps.logger;
    this.now = opts.now ?? Date.now.bind(Date);
  }

  /**
   * Start the polling loop. First tick fires immediately; subsequent ticks
   * fire every `config.ingest.intervalMs` milliseconds.
   */
  start(): void {
    this.stopped = false;
    void this.tick();
    this.intervalHandle = setInterval(() => {
      if (!this.stopped) void this.tick();
    }, this.config.ingest.intervalMs);
  }

  /**
   * Stop the polling loop and wait for all in-flight rule promises to settle.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    // Drain in-flight promises
    await Promise.allSettled(this.inFlightPromises.values());
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async tick(): Promise<void> {
    const rules = this.config.ingest.rules;
    const nowMs = this.now();

    await Promise.allSettled(
      rules
        .filter((rule, index) => {
          const key = `${rule.name}-${index}`;
          if (this.inFlightKeys.has(key)) {
            this.logger.warn(`rule lagging: ${rule.name} — skipping tick`);
            return false;
          }
          return true;
        })
        .map((rule) => {
          // Compute original index by finding the rule in the config rules list
          const ruleIndex = rules.indexOf(rule);
          const key = `${rule.name}-${ruleIndex}`;
          const p = this.processRule(rule, ruleIndex, nowMs).finally(() => {
            this.inFlightKeys.delete(key);
            this.inFlightPromises.delete(key);
          });
          this.inFlightKeys.add(key);
          this.inFlightPromises.set(key, p);
          return p;
        }),
    );
  }

  private async processRule(rule: PrometheusRule, ruleIndex: number, nowMs: number): Promise<void> {
    const correlationId = `prometheus-${ruleIndex}-${nowMs}`;

    let response;
    try {
      response = await this.promClient.queryInstant(rule.query);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Prometheus query failed for rule "${rule.name}": ${msg}`);
      return;
    }

    const alerts = mapMetricResultToAlerts(rule, response, nowMs);
    if (alerts.length === 0) return;

    try {
      await this.useCase.execute(alerts, correlationId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`ProcessIncidentUseCase failed for rule "${rule.name}": ${msg}`);
    }
  }
}
