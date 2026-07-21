import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleNotifier, SlackNotifier } from '../slack.adapter.js';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../../domain/entities/incident.js';
import { NotifyOutcome } from '../../../domain/ports/index.js';
import { AlertType } from '../../../shared/constants.js';
import * as metricsModule from '../../../shared/metrics/index.js';

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

describe('SlackNotifier', () => {
  const mockFetch = vi.fn();
  let notifier: SlackNotifier;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    notifier = new SlackNotifier('test-token', 'test-channel');
  });

  it('sends analysis message with correct structure when analysis provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const cluster = makeCluster();
    const analysis = makeAnalysis();

    await notifier.send(cluster, analysis);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    });

    const body = JSON.parse(options.body as string);
    expect(body.channel).toBe('test-channel');
    // 6 blocks: header, section (fields), probable cause, recommended steps, divider, actions
    expect(body.blocks).toHaveLength(6);

    // Header
    expect(body.blocks[0].type).toBe('header');
    expect(body.blocks[0].text.text).toContain('checkout-service');

    // Section with fields
    expect(body.blocks[1].type).toBe('section');
    expect(body.blocks[1].fields).toHaveLength(4);

    // Probable cause
    expect(body.blocks[2].type).toBe('section');
    expect(body.blocks[2].text.text).toContain('Database connection pool exhaustion');

    // Recommended steps
    expect(body.blocks[3].type).toBe('section');
    expect(body.blocks[3].text.text).toContain('1. Check database connection pool size');

    // Divider
    expect(body.blocks[4].type).toBe('divider');

    // Actions with buttons
    expect(body.blocks[5].type).toBe('actions');
    expect(body.blocks[5].elements).toHaveLength(1); // only Acknowledge button
    expect(body.blocks[5].elements[0].text.text).toBe('✅ Acknowledge');
  });

  it('includes rollback button when requires_rollback is true', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const cluster = makeCluster();
    const analysis = makeAnalysis({ requires_rollback: true });

    await notifier.send(cluster, analysis);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const actions = body.blocks[5]; // Actions is at index 5

    expect(actions.elements).toHaveLength(2);
    expect(actions.elements[1].text.text).toBe('⏪ Trigger Rollback');
    expect(actions.elements[1].style).toBe('danger');
    expect(actions.elements[1].action_id).toBe('trigger_rollback');
  });

  it('sends fallback message when analysis is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const cluster = makeCluster();

    await notifier.send(cluster, null);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);

    // Header should indicate no AI diagnosis
    expect(body.blocks[0].text.text).toContain('no AI diagnosis');

    // Should have only 2 blocks (header + section, no divider or actions)
    expect(body.blocks).toHaveLength(2);

    // Section should mention manual investigation required
    expect(body.blocks[1].text.text).toContain('manual investigation required');
  });

  it('sanitizes endpointPath by stripping backticks', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const cluster = makeCluster({ endpointPath: '/api/v1/`checkout`/process' });
    const analysis = makeAnalysis();

    await notifier.send(cluster, analysis);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const endpointField = body.blocks[1].fields.find((f: any) => f.text.includes('Endpoint'));

    // Backticks should be stripped
    expect(endpointField.text).not.toContain('`');
    expect(endpointField.text).toContain('checkout');
  });

  it('throws error when Slack API returns error', async () => {
    // res.ok is true (HTTP 200), but body.ok is false (Slack API error)
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    });

    const cluster = makeCluster();
    const analysis = makeAnalysis();

    await expect(notifier.send(cluster, analysis)).rejects.toThrow('Slack error: channel_not_found');
  });

  it('throws error when fetch response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const cluster = makeCluster();
    const analysis = makeAnalysis();

    await expect(notifier.send(cluster, analysis)).rejects.toThrow('Slack API error: 500');
  });
});

describe('SlackNotifier — notificationsTotal emission', () => {
  const mockFetch = vi.fn();
  let notifier: SlackNotifier;
  let incSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    notifier = new SlackNotifier('test-token', 'test-channel');
    incSpy = vi.spyOn(metricsModule.notificationsTotal, 'inc');
  });

  it('increments notificationsTotal with channel=slack, outcome=success on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await notifier.send(makeCluster(), makeAnalysis());

    expect(incSpy).toHaveBeenCalledOnce();
    expect(incSpy).toHaveBeenCalledWith({ channel: 'slack', outcome: 'success' });
  });

  it('increments notificationsTotal with channel=slack, outcome=failure on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(notifier.send(makeCluster(), makeAnalysis())).rejects.toThrow();

    expect(incSpy).toHaveBeenCalledOnce();
    expect(incSpy).toHaveBeenCalledWith({ channel: 'slack', outcome: 'failure' });
  });

  it('does not double-increment on a single send call', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await notifier.send(makeCluster(), makeAnalysis());

    expect(incSpy).toHaveBeenCalledTimes(1);
  });
});

describe('SlackNotifier — structured NotifyResult', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
  });

  it('returns outcome=success, latencyMs, and the concrete channel on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    const notifier = new SlackNotifier('test-token', 'alerts-prod');

    const result = await notifier.send(makeCluster(), makeAnalysis());

    expect(result.outcome).toBe(NotifyOutcome.Success);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.channels).toEqual(['alerts-prod']);
  });

  it('reports the channel it actually posts to, not the unused override param', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    const notifier = new SlackNotifier('test-token', 'alerts-prod');

    // SlackNotifier posts to its configured channel; the override is handled
    // one level up by RoutingNotifier. The result must reflect reality.
    const result = await notifier.send(makeCluster(), makeAnalysis(), 'ignored-override');

    expect(result.channels).toEqual(['alerts-prod']);
  });

  it('still throws on Slack API failure (failure outcome is recorded by the caller)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const notifier = new SlackNotifier('test-token', 'alerts-prod');

    await expect(notifier.send(makeCluster(), makeAnalysis())).rejects.toThrow(
      'Slack API error: 500',
    );
  });
});

describe('ConsoleNotifier — structured NotifyResult', () => {
  it('returns a successful result addressed at the console channel', async () => {
    const notifier = new ConsoleNotifier();

    const result = await notifier.send(makeCluster(), makeAnalysis());

    expect(result.outcome).toBe(NotifyOutcome.Success);
    expect(result.channels).toEqual(['console']);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('still records the sent payload for local dev inspection', async () => {
    const notifier = new ConsoleNotifier();
    const cluster = makeCluster();

    await notifier.send(cluster, null);

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].cluster).toBe(cluster);
    expect(notifier.sent[0].analysis).toBeNull();
  });
});