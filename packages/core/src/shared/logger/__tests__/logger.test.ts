import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── loki-transport mock ───────────────────────────────────────────────────
const mockInitLokiBuffer = vi.hoisted(() => vi.fn());
const mockCreateLokiDestination = vi.hoisted(() =>
  vi.fn().mockReturnValue({ write: vi.fn((_, __, cb) => cb()), on: vi.fn() }),
);

vi.mock('../loki-transport.js', () => ({
  initLokiBuffer: mockInitLokiBuffer,
  createLokiDestination: mockCreateLokiDestination,
  flushLoki: vi.fn().mockResolvedValue(undefined),
}));

import { createLogger, reinitLogger } from '../index.js';

describe('createLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['LOKI_URL'];
    reinitLogger();
  });

  afterEach(() => {
    delete process.env['LOKI_URL'];
    vi.unstubAllEnvs();
    reinitLogger();
  });

  describe('without LOKI_URL', () => {
    it('returns a pino logger instance with expected methods', () => {
      const log = createLogger();
      expect(typeof log.info).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.debug).toBe('function');
    });

    it('does NOT init Loki transport when LOKI_URL is absent', () => {
      createLogger();
      expect(mockInitLokiBuffer).not.toHaveBeenCalled();
    });

    it('accepts an optional name argument and still returns a valid logger', () => {
      const log = createLogger({ name: 'my-service' });
      expect(typeof log.info).toBe('function');
      expect(mockInitLokiBuffer).not.toHaveBeenCalled();
    });

    it('accepts a string level for backwards compatibility', () => {
      const log = createLogger('debug');
      expect(typeof log.info).toBe('function');
      expect(log.level).toBe('debug');
    });
  });

  describe('with LOKI_URL', () => {
    const LOKI_URL = 'https://myuser:mytoken@logs-prod-024.grafana.net/loki/api/v1/push';

    it('calls initLokiBuffer when LOKI_URL env var is set and reinitLogger is called', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);
      reinitLogger();

      expect(mockInitLokiBuffer).toHaveBeenCalled();
    });

    it('passes correct host (without credentials or path) to initLokiBuffer', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);
      reinitLogger();

      const [config] = mockInitLokiBuffer.mock.calls[0] as [Record<string, unknown>];
      expect(config['host']).toBe('https://logs-prod-024.grafana.net');
    });

    it('passes credentials extracted from the URL to initLokiBuffer', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);
      reinitLogger();

      const [config] = mockInitLokiBuffer.mock.calls[0] as [Record<string, unknown>];
      expect(config['username']).toBe('myuser');
      expect(config['password']).toBe('mytoken');
    });

    it('sets Loki labels with service_name=junando and environment from NODE_ENV', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);
      vi.stubEnv('NODE_ENV', 'staging');
      reinitLogger();

      const [config] = mockInitLokiBuffer.mock.calls[0] as [Record<string, unknown>];
      expect(config['labels']).toMatchObject({ service_name: 'junando', environment: 'staging' });
    });

    it('defaults environment to production when NODE_ENV is unset', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);
      delete process.env['NODE_ENV'];
      reinitLogger();

      const [config] = mockInitLokiBuffer.mock.calls[0] as [Record<string, unknown>];
      expect((config['labels'] as Record<string, string>)['environment']).toBe('production');
    });

    it('createLogger returns the Loki logger after reinitLogger is called', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);
      reinitLogger();
      vi.clearAllMocks();

      const log = createLogger(); // returns proxy to existing singleton
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      // initLokiBuffer not called again — singleton reused
      expect(mockInitLokiBuffer).not.toHaveBeenCalled();
    });
  });
});
