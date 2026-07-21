import { describe, it, expect, afterEach } from 'vitest';
import { redact } from '../redaction.js';

const REDACTED = '[REDACTED]';
const MAX_STRING_CHARS = 1000;
const TRUNCATION_SUFFIX = '...[truncated]';

afterEach(() => {
  delete process.env['NODE_ENV'];
});

describe('redact', () => {
  it('passes whitelisted scalar fields through untouched', () => {
    const input = {
      requestId: 'req-1',
      correlationId: 'corr-1',
      timestamp: '2026-07-21T15:00:00.000Z',
      component: 'worker',
      version: '1.2.3',
      durationMs: 420,
    };

    expect(redact(input)).toEqual(input);
  });

  it('passes whitelisted section objects through with values intact', () => {
    const input = {
      cluster: { fingerprint: 'fp', serviceName: 'api', alertCount: 2, spanCount: 5 },
      dedup: { isNew: true, ttlSeconds: 900 },
      rule: { matched: true, suppressed: false },
      llm: { provider: 'anthropic', model: 'claude', latencyMs: 10, urgency: 'high', tokens: 5 },
      notify: { channels: ['slack', 'teams'], outcome: 'sent', latencyMs: 30 },
    };

    expect(redact(input)).toEqual(input);
  });

  it('replaces non-whitelisted fields with [REDACTED]', () => {
    const input = {
      requestId: 'req-1',
      rawPayload: { email: 'user@example.com', token: 'secret-token' },
      headers: { authorization: 'Bearer abc' },
    };

    const result = redact(input);

    expect(result['requestId']).toBe('req-1');
    expect(result['rawPayload']).toBe(REDACTED);
    expect(result['headers']).toBe(REDACTED);
  });

  it('truncates whitelisted strings longer than 1000 chars', () => {
    const long = 'a'.repeat(MAX_STRING_CHARS + 500);
    const result = redact({ version: long });

    expect(result['version']).toBe(long.slice(0, MAX_STRING_CHARS) + TRUNCATION_SUFFIX);
    expect((result['version'] as string).length).toBe(
      MAX_STRING_CHARS + TRUNCATION_SUFFIX.length,
    );
  });

  it('truncates long strings nested inside whitelisted sections and arrays', () => {
    const long = 'b'.repeat(MAX_STRING_CHARS + 1);
    const result = redact({
      cluster: { fingerprint: long, serviceName: 'api', alertCount: 1, spanCount: 1 },
      notify: { channels: [long, 'slack'], outcome: 'sent', latencyMs: 1 },
    });

    const cluster = result['cluster'] as Record<string, unknown>;
    const notify = result['notify'] as Record<string, unknown>;
    expect(cluster['fingerprint']).toBe(long.slice(0, MAX_STRING_CHARS) + TRUNCATION_SUFFIX);
    expect((notify['channels'] as string[])[0]).toBe(
      long.slice(0, MAX_STRING_CHARS) + TRUNCATION_SUFFIX,
    );
    expect((notify['channels'] as string[])[1]).toBe('slack');
  });

  it('keeps error.message and error.name but drops the stack outside development', () => {
    process.env['NODE_ENV'] = 'production';
    const result = redact({
      error: { message: 'boom', name: 'TypeError', stack: 'at secret/file.ts:1:1' },
    });

    expect(result['error']).toEqual({ message: 'boom', name: 'TypeError' });
  });

  it('keeps the error stack in development', () => {
    process.env['NODE_ENV'] = 'development';
    const result = redact({
      error: { message: 'boom', name: 'TypeError', stack: 'at file.ts:1:1' },
    });

    expect(result['error']).toEqual({
      message: 'boom',
      name: 'TypeError',
      stack: 'at file.ts:1:1',
    });
  });

  it('drops unknown keys inside the error section', () => {
    const result = redact({
      error: { message: 'boom', password: 'hunter2' },
    });

    expect(result['error']).toEqual({ message: 'boom' });
  });

  it('does not mutate the input object', () => {
    const input = { requestId: 'req-1', rawPayload: 'sensitive' };
    redact(input);

    expect(input['rawPayload']).toBe('sensitive');
  });
});
