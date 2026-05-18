import type { ProcessIncidentUseCase } from '@junando/core';
import type { ILokiHttpClient } from '../ports/loki-http-client.port.js';
import type { IngestConfig, IngestRule } from '../config/ingest-config.schema.js';
import { mapLokiResultToAlerts } from '../mapping/log-to-alert.mapper.js';

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
// IngestRunnerDeps
// ---------------------------------------------------------------------------

export interface IngestRunnerDeps {
  config: IngestConfig;
  lokiClient: ILokiHttpClient;
  processIncidentUseCase: Pick<ProcessIncidentUseCase, 'execute'>;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// IngestRunner
// ---------------------------------------------------------------------------

/**
 * Polling loop that queries Loki on a fixed interval and forwards matches to
 * ProcessIncidentUseCase. Each tick fans out all configured rules concurrently
 * via Promise.allSettled — one rule failure never blocks others.
 *
 * Lagging rules (previous tick still running) are skipped with a warning.
 * stop() drains all in-flight promises before resolving.
 */
export class IngestRunner {
  private readonly config: IngestConfig;
  private readonly lokiClient: ILokiHttpClient;
  private readonly useCase: Pick<ProcessIncidentUseCase, 'execute'>;
  private readonly logger: Logger;

  /** Tracks in-flight per-rule promises to enable lagging-rule skip. */
  private readonly inFlight = new Map<string, Promise<void>>();

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(deps: IngestRunnerDeps) {
    this.config = deps.config;
    this.lokiClient = deps.lokiClient;
    this.useCase = deps.processIncidentUseCase;
    this.logger = deps.logger;
  }

  /**
   * Start the polling loop. First tick fires immediately; subsequent ticks
   * fire every `config.ingest.intervalMs` milliseconds.
   */
  start(): void {
    this.stopped = false;
    // Immediate first tick
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
    await Promise.allSettled(this.inFlight.values());
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async tick(): Promise<void> {
    const rules = this.config.ingest.rules;
    const nowMs = Date.now();
    const intervalMs = this.config.ingest.intervalMs;
    const queryStartMs = nowMs - intervalMs;

    await Promise.allSettled(
      rules
        .filter((rule) => {
          if (this.inFlight.has(rule.name)) {
            this.logger.warn(`rule lagging: ${rule.name} — skipping tick`);
            return false;
          }
          return true;
        })
        .map((rule) => {
          const p = this.processRule(rule, queryStartMs, nowMs).finally(() => {
            this.inFlight.delete(rule.name);
          });
          this.inFlight.set(rule.name, p);
          return p;
        }),
    );
  }

  private async processRule(rule: IngestRule, queryStartMs: number, nowMs: number): Promise<void> {
    let response;
    try {
      response = await this.lokiClient.queryRange({
        query: rule.query,
        start: queryStartMs * 1_000_000, // ms → ns
        end: nowMs * 1_000_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Loki query failed for rule "${rule.name}": ${msg}`);
      return;
    }

    const alerts = mapLokiResultToAlerts(rule, response, queryStartMs, nowMs);
    if (alerts.length === 0) return;

    // Use ruleName as the correlation ID for ingest-sourced alerts
    await this.useCase.execute(alerts, rule.name);
  }
}
