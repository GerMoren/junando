import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeamsNotifier, TeamsNotifierError } from '../teams.adapter.js';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../../domain/entities/incident.js';
import { AlertType } from '../../../shared/constants.js';

function makeCluster(overrides: Partial<AlertCluster> = {}): AlertCluster {
  return {
    fingerprint: 'fp123',
    serviceName: 'checkout-service',
    alertType: AlertType.Error,
    endpointPath: '/api/v1/checkout',
    alertCount: 5,
    representativeTraceIds: ['trace-1', 'trace-2'],
    firstSeenAt: '2026-05-08T10:00:00.000Z',
    latencyP99Ms: 1200,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<LLMAnalysis> = {}): LLMAnalysis {
  return {
    probable_cause: 'Database connection pool exhaustion',
    impacted_services: ['checkout-service', 'payment-service'],
    recommended_steps: [
      'Check database connection pool size',
      'Review recent traffic spike',
      'Scale up database replicas',
    ],
    urgency_level: 'high',
    requires_rollback: false,
    ...overrides,
  };
}

const VALID_WEBHOOK = 'https://prod.example.powerautomate.com/invoke?api-version=1';

describe('TeamsNotifier', () => {
  const mockFetch = vi.fn();
  let notifier: TeamsNotifier;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    notifier = new TeamsNotifier(VALID_WEBHOOK);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── TNT-03: correct POST body shape ───────────────────────────────────────

  it('POSTs with correct contentType and message type shape (TNT-03)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    await notifier.send(makeCluster(), makeAnalysis());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0];

    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body as string);
    expect(body.type).toBe('message');
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
  });

  // ── TNT-01: full analysis card (Variant A) ────────────────────────────────

  it('builds full analysis card with service, alertCount, endpoint, urgency, cause, steps, action (TNT-01)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    const cluster = makeCluster();
    const analysis = makeAnalysis();

    await notifier.send(cluster, analysis);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const card = body.attachments[0].content;

    expect(card.$schema).toBe('http://adaptivecards.io/schemas/adaptive-card.json');
    expect(card.type).toBe('AdaptiveCard');
    expect(card.version).toBe('1.5');

    // Title TextBlock
    expect(card.body[0].type).toBe('TextBlock');
    expect(card.body[0].text).toContain('checkout-service');

    // FactSet
    const factSet = card.body[1];
    expect(factSet.type).toBe('FactSet');
    const factTitles = factSet.facts.map((f: any) => f.title);
    expect(factTitles).toContain('Service');
    expect(factTitles).toContain('Alerts');
    expect(factTitles).toContain('Endpoint');
    expect(factTitles).toContain('Urgency');

    // Probable cause section present
    const bodyText = JSON.stringify(card.body);
    expect(bodyText).toContain('Database connection pool exhaustion');
    expect(bodyText).toContain('Check database connection pool size');

    // OpenUrl action
    expect(card.actions).toHaveLength(1);
    expect(card.actions[0].type).toBe('Action.OpenUrl');
    expect(card.actions[0].url).toContain('fp123');
  });

  // ── TNT-02: fallback card (Variant B, analysis === null) ──────────────────

  it('builds fallback card without cause/steps when analysis is null (TNT-02)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    await notifier.send(makeCluster(), null);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const card = body.attachments[0].content;

    // Title includes "no AI diagnosis"
    expect(card.body[0].text).toContain('no AI diagnosis');

    // Service and alert count present
    const factSet = card.body[1];
    expect(factSet.type).toBe('FactSet');
    const factTitles = factSet.facts.map((f: any) => f.title);
    expect(factTitles).toContain('Service');
    expect(factTitles).toContain('Alerts');

    // No probable cause or recommended steps
    const bodyText = JSON.stringify(card.body);
    expect(bodyText).not.toContain('Probable cause');
    expect(bodyText).not.toContain('Recommended steps');

    // Has View in Junando action
    expect(card.actions[0].title).toContain('Junando');
  });

  // ── TNT-04: accept 200 and 202 ────────────────────────────────────────────

  it('resolves without error on HTTP 202 (TNT-04)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 202, text: async () => '' });
    await expect(notifier.send(makeCluster(), makeAnalysis())).resolves.toBeUndefined();
  });

  it('resolves without error on HTTP 200 (TNT-04)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    await expect(notifier.send(makeCluster(), makeAnalysis())).resolves.toBeUndefined();
  });

  // ── TNT-05: throw on non-2xx with status + host only (no body) ────────────

  it('throws TeamsNotifierError with status and host on HTTP 400 (TNT-05)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, text: async () => 'Bad Request' });
    const err = await notifier.send(makeCluster(), makeAnalysis()).catch((e) => e as Error);
    expect(err).toBeInstanceOf(TeamsNotifierError);
    expect(err.message).toMatch(/Teams webhook error 400 \(host: prod\.example\.powerautomate\.com\)/);
  });

  it('throws TeamsNotifierError with status and host on HTTP 500 (TNT-05)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Server Error' });
    const err = await notifier.send(makeCluster(), makeAnalysis()).catch((e) => e as Error);
    expect(err).toBeInstanceOf(TeamsNotifierError);
    expect(err.message).toMatch(/Teams webhook error 500 \(host: prod\.example\.powerautomate\.com\)/);
  });

  // ── TNT-09: HTTP error message contains only status and host — never the response body ──
  // Round 2 follow-up: sanitizing the body is brittle (encoded variants, Azure SAS
  // params like code=, sv=, sp= all bypass narrow regexes). Omit body entirely.

  it('TNT-09: HTTP error message contains only status and host — never the response body', async () => {
    const webhookWithSecret = 'https://prod.example.powerautomate.com/invoke?api-version=1&sig=SUPER_SECRET_TOKEN_abc123XYZ';
    const leakyBody = `request failed for url ${webhookWithSecret} with details: ` + 'XXXXX'.repeat(160);
    mockFetch.mockResolvedValue({ ok: false, status: 502, text: async () => leakyBody });

    const leakyNotifier = new TeamsNotifier(webhookWithSecret);
    const err = await leakyNotifier.send(makeCluster(), makeAnalysis()).catch((e) => e as Error);

    expect(err).toBeInstanceOf(TeamsNotifierError);
    // No part of the body — verbatim URL, sig token, or arbitrary marker — leaks.
    expect(err.message).not.toContain(webhookWithSecret);
    expect(err.message).not.toContain('SUPER_SECRET_TOKEN_abc123XYZ');
    expect(err.message).not.toContain('XXXXX');
    // Message shape: status + host only.
    expect(err.message).toMatch(/Teams webhook error 502 \(host: prod\.example\.powerautomate\.com\)/);
  });

  // ── TNT-06: sanitization ──────────────────────────────────────────────────

  it('strips HTML tags from service name (TNT-06)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    const cluster = makeCluster({ serviceName: '<script>alert(1)</script>checkout' });
    await notifier.send(cluster, makeAnalysis());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const rawBody = JSON.stringify(body);
    expect(rawBody).not.toContain('<script>');
    expect(rawBody).toContain('checkout');
  });

  it('escapes Adaptive Card markdown special chars in cause text (TNT-06)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    const analysis = makeAnalysis({ probable_cause: '**bold** and _italic_' });
    await notifier.send(makeCluster(), analysis);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const rawBody = JSON.stringify(body);
    // After sanitization, raw ** and __ should be escaped
    expect(rawBody).not.toContain('**bold**');
    expect(rawBody).not.toContain('_italic_');
  });

  // ── TNT-07 + TNT-08: timeout, host-only in error ──────────────────────────

  it('throws TeamsNotifierError with timeout ms and host-only (no full URL) on timeout (TNT-07 + TNT-08)', async () => {
    vi.useFakeTimers();

    mockFetch.mockImplementation(
      (_url: string, options: RequestInit) => new Promise<never>((_, reject) => {
        const signal = options.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      }),
    );

    const notifierFast = new TeamsNotifier(VALID_WEBHOOK, 100);

    // Start the send; advance timers to trigger abort; then await resolution
    const sendPromise = notifierFast.send(makeCluster(), makeAnalysis()).catch((err) => err as TeamsNotifierError);
    await vi.advanceTimersByTimeAsync(150);
    const result = await sendPromise;

    expect(result).toBeInstanceOf(TeamsNotifierError);
    expect(result.message).toContain('100ms');
    expect(result.message).toContain('prod.example.powerautomate.com');
    expect(result.message).not.toContain('api-version');
  });

  // ── TNT-10: hostname is pre-computed at construction time ────────────────
  // Prevents the catch block from doing `new URL(this.webhookUrl).hostname`,
  // which would throw and shadow the original error if the URL ever became
  // invalid (defense in depth — also more efficient).

  it('TNT-10: hostname for error context is captured at construction, not in the catch path', async () => {
    vi.useFakeTimers();

    mockFetch.mockImplementation(
      (_url: string, options: RequestInit) => new Promise<never>((_, reject) => {
        const signal = options.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      }),
    );

    const constructedHost = 'prod.example.powerautomate.com';
    const notifierFast = new TeamsNotifier(`https://${constructedHost}/invoke?api-version=1`, 50);

    // Mutate webhookUrl to an invalid value after construction. If the catch
    // block parses lazily, it will throw inside the error handler and the
    // original AbortError context will be lost.
    (notifierFast as unknown as { webhookUrl: string }).webhookUrl = 'not-a-valid-url';

    const sendPromise = notifierFast
      .send(makeCluster(), makeAnalysis())
      .catch((err) => err as Error);
    await vi.advanceTimersByTimeAsync(100);
    const result = await sendPromise;

    expect(result).toBeInstanceOf(TeamsNotifierError);
    expect(result.message).toContain('50ms');
    expect(result.message).toContain(constructedHost);
  });
});
