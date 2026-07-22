import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoopRollbackActionHandler } from '../noop-rollback-action.handler.js';
import { AlertType } from '../../../shared/constants.js';

const { infoSpy } = vi.hoisted(() => ({ infoSpy: vi.fn() }));

vi.mock('../../../shared/logger/index.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: infoSpy,
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('NoopRollbackActionHandler', () => {
  beforeEach(() => {
    infoSpy.mockClear();
  });

  it('returns ok=true with a safe message', async () => {
    const handler = new NoopRollbackActionHandler();
    const result = await handler.handle({
      fingerprint: 'fp-abc',
      serviceName: 'checkout-service',
      endpointPath: '/api/orders',
      alertType: AlertType.Error,
      urgencyLevel: 'high',
      triggeredBy: { id: 'U123', username: 'alice', channel: 'slack' },
      messageTs: '1234567890.123456',
    });

    expect(result).toEqual({
      ok: true,
      message: 'Rollback action logged; no handler configured.',
    });
  });

  it('logs the request with structured fields', async () => {
    const handler = new NoopRollbackActionHandler();
    const request = {
      fingerprint: 'fp-abc',
      serviceName: 'checkout-service',
      endpointPath: '/api/orders',
      alertType: AlertType.Error,
      urgencyLevel: 'high',
      triggeredBy: { id: 'U123', username: 'alice', channel: 'slack' },
      messageTs: '1234567890.123456',
    };

    await handler.handle(request);

    expect(infoSpy).toHaveBeenCalledOnce();
    const [meta, msg] = infoSpy.mock.calls[0] as [unknown, string];
    expect(msg).toBe('Rollback action received; no handler configured.');
    expect(meta).toMatchObject({
      fingerprint: 'fp-abc',
      serviceName: 'checkout-service',
      endpointPath: '/api/orders',
      alertType: AlertType.Error,
      urgencyLevel: 'high',
      triggeredBy: request.triggeredBy,
      messageTs: '1234567890.123456',
    });
  });

  it('never throws even when optional fields are missing', async () => {
    const handler = new NoopRollbackActionHandler();
    const result = await handler.handle({
      fingerprint: 'fp-min',
      serviceName: 'tiny-service',
      endpointPath: '/ping',
      alertType: AlertType.Warning,
      triggeredBy: { channel: 'slack' },
    });

    expect(result.ok).toBe(true);
  });
});
