import { describe, it, expect } from 'vitest';
import { WideEventBuilder } from '../wide-event-builder.js';
import { Component, Outcome, Stage, SamplingDecision } from '../enums.js';

const MAX_EVENT_BYTES = 256 * 1024;

describe('WideEventBuilder', () => {
  describe('flush', () => {
    it('returns a WideEvent with requestId, component and an ISO 8601 timestamp', () => {
      const builder = new WideEventBuilder('req-123', Component.Worker);
      const event = builder.flush();

      expect(event.requestId).toBe('req-123');
      expect(event.component).toBe('worker');
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('omits optional fields that were never set', () => {
      const event = new WideEventBuilder('req-1', Component.Webhook).flush();

      expect('correlationId' in event).toBe(false);
      expect('cluster' in event).toBe(false);
      expect('dedup' in event).toBe(false);
      expect('rule' in event).toBe(false);
      expect('llm' in event).toBe(false);
      expect('notify' in event).toBe(false);
      expect('durationMs' in event).toBe(false);
      expect('error' in event).toBe(false);
    });

    it('generates a fresh timestamp on each flush', async () => {
      const builder = new WideEventBuilder('req-1', Component.Worker);
      const first = builder.flush();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = builder.flush();

      expect(first.timestamp).not.toBe(second.timestamp);
    });
  });

  describe('set', () => {
    it('accumulates individual fields and returns them on flush', () => {
      const event = new WideEventBuilder('req-1', Component.UseCase)
        .set('correlationId', 'corr-abc')
        .set('durationMs', 420)
        .flush();

      expect(event.correlationId).toBe('corr-abc');
      expect(event.durationMs).toBe(420);
    });

    it('stores a structured llm section with exact values', () => {
      const event = new WideEventBuilder('req-1', Component.Llm)
        .set('llm', {
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          latencyMs: 1800,
          urgency: 'high',
          tokens: 512,
        })
        .flush();

      expect(event.llm).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        latencyMs: 1800,
        urgency: 'high',
        tokens: 512,
      });
    });
  });

  describe('merge', () => {
    it('accumulates multiple fields at once', () => {
      const event = new WideEventBuilder('req-1', Component.UseCase)
        .merge({
          cluster: {
            fingerprint: 'fp-99',
            serviceName: 'payments-api',
            alertCount: 3,
            spanCount: 12,
          },
          dedup: { isNew: true, ttlSeconds: 900 },
        })
        .flush();

      expect(event.cluster).toEqual({
        fingerprint: 'fp-99',
        serviceName: 'payments-api',
        alertCount: 3,
        spanCount: 12,
      });
      expect(event.dedup).toEqual({ isNew: true, ttlSeconds: 900 });
    });

    it('never overrides builder-owned requestId, component or timestamp', () => {
      const event = new WideEventBuilder('req-original', Component.Worker)
        .merge({
          requestId: 'req-hijack',
          component: 'webhook',
          timestamp: '1970-01-01T00:00:00.000Z',
          durationMs: 10,
        })
        .flush();

      expect(event.requestId).toBe('req-original');
      expect(event.component).toBe('worker');
      expect(event.timestamp).not.toBe('1970-01-01T00:00:00.000Z');
      expect(event.durationMs).toBe(10);
    });
  });

  describe('size guard', () => {
    it('marks and truncates events whose serialized size exceeds 256KB', () => {
      const event = new WideEventBuilder('req-big', Component.Worker)
        .set('version', 'x'.repeat(300 * 1024))
        .flush();

      expect(event._truncated).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(event), 'utf8')).toBeLessThanOrEqual(
        MAX_EVENT_BYTES,
      );
    });

    it('does not mark events within the size limit', () => {
      const event = new WideEventBuilder('req-small', Component.Worker)
        .set('version', '1.2.3')
        .flush();

      expect('_truncated' in event).toBe(false);
    });
  });
});

describe('logger enums', () => {
  it('Component covers every pipeline stage from the taxonomy', () => {
    expect(Component).toEqual({
      Webhook: 'webhook',
      Worker: 'worker',
      UseCase: 'useCase',
      Llm: 'llm',
      Notifier: 'notifier',
      Dedup: 'dedup',
      Traces: 'traces',
      Ingest: 'ingest',
      Rollback: 'rollback',
    });
  });

  it('Outcome covers the spec outcome paths', () => {
    expect(Outcome.Success).toBe('success');
    expect(Outcome.Suppressed).toBe('suppressed');
    expect(Outcome.Degraded).toBe('degraded');
    expect(Outcome.Error).toBe('error');
    expect(Outcome.Accepted).toBe('accepted');
    expect(Outcome.Empty).toBe('empty');
    expect(Outcome.ParseError).toBe('parse_error');
  });

  it('Stage covers the pipeline stages that write into the builder', () => {
    expect(Stage.Dedup).toBe('dedup');
    expect(Stage.RulesPre).toBe('rulesPre');
    expect(Stage.Traces).toBe('traces');
    expect(Stage.Llm).toBe('llm');
    expect(Stage.RulesPost).toBe('rulesPost');
    expect(Stage.Notify).toBe('notify');
  });

  it('SamplingDecision names the tail-sampling reasons', () => {
    expect(SamplingDecision.Error).toBe('error');
    expect(SamplingDecision.Slow).toBe('slow');
    expect(SamplingDecision.Random).toBe('random');
    expect(SamplingDecision.Skipped).toBe('skipped');
  });
});
