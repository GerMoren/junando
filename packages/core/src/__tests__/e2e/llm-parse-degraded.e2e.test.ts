/**
 * Acceptance gate for #292 — proves the fix is wired end to end through
 * ProcessIncidentUseCase -> SlackNotifier -> the wide event, not merely
 * unit-tested in isolation:
 *   - the notifier still fires with analysis === null (no dropped alert)
 *   - the wide event reports outcome=degraded with the parse-failure reason
 *   - degraded events with no error section still survive tail sampling
 *   - the rendered Slack payload carries no rollback action
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import pino from 'pino';
import { ProcessIncidentUseCase } from '../../application/use-cases/process-incident.use-case.js';
import { normalizePayload } from '../../application/dtos/normalize-payload.js';
import { InMemoryDeduplicationStore } from '../../infrastructure/dedup/redis-dedup.adapter.js';
import { OpenRouterProvider } from '../../infrastructure/llm/openrouter.provider.js';
import { SlackNotifier } from '../../infrastructure/notifier/slack.adapter.js';
import { ROLLBACK_ACTION_ID, SLACK_API_URL } from '../../shared/constants.js';
import { MockNotifier } from './helpers/mock-notifier.js';
import { latencySpikePayload } from './fixtures/latency-spike.fixture.js';
import type { ITraceRepository } from '../../domain/ports/index.js';
import type { Logger } from '../../shared/logger/index.js';

const noopTraces: ITraceRepository = {
  findByTraceId: async () => [],
};

/** Captures every logger.info call so we can assert on the flushed wide event. */
function makeCapturingLogger(): { logger: Logger; events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  const base = pino({ level: 'silent' });
  const logger = {
    ...base,
    info: (obj: Record<string, unknown>) => {
      events.push(obj);
    },
  } as unknown as Logger;
  return { logger, events };
}

describe('E2E: LLM parse-degraded — acceptance gate for #292', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('notifies with null analysis, marks the wide event degraded, survives sampling, and closes the rollback vector', async () => {
    // Not needed to pass: shouldSample returns early on Degraded. Set so that
    // deleting that exemption fails this test every run instead of ~95% of them.
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === SLACK_API_URL) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { index: 0, message: { role: 'assistant', content: 'No rollback is needed here.' } },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', mockFetch);

    const notifier = new MockNotifier();
    const { logger, events } = makeCapturingLogger();
    const dedup = new InMemoryDeduplicationStore();
    const llm = new OpenRouterProvider('test-key');

    const useCase = new ProcessIncidentUseCase({
      dedup,
      traces: noopTraces,
      llm,
      notifier,
      logger,
      dedupTtlSeconds: 300,
    });

    const alerts = normalizePayload(latencySpikePayload);
    await useCase.execute(alerts, 'corr-parse-degraded');

    // Notifier still fires — no dropped alert.
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]!.analysis).toBeNull();

    // Wide event reports the degraded outcome and reason, without a transport error section.
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event['outcome']).toBe('degraded');
    expect((event['llm'] as Record<string, unknown>)['degradedReason']).toBe('unparseable_response');
    expect((event['llm'] as Record<string, unknown>)['urgency']).toBeUndefined();
    expect(event['error']).toBeUndefined();

    // Rollback-vector assertion against the actual Slack payload the notifier would send.
    const slackNotifier = new SlackNotifier('bot-token', 'incidents');
    const cluster = notifier.calls[0]!.cluster;
    await slackNotifier.send(cluster, notifier.calls[0]!.analysis);
    const slackCall = mockFetch.mock.calls.find(([callUrl]) => callUrl === SLACK_API_URL);
    expect(slackCall).toBeDefined();
    const body = JSON.parse((slackCall![1] as RequestInit).body as string) as { blocks: unknown[] };
    expect(JSON.stringify(body.blocks)).not.toContain(ROLLBACK_ACTION_ID);
  });
});
