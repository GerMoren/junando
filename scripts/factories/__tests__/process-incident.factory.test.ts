import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis before any factory import
vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    status: 'ready',
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

// Partial mock of core — keep ProcessIncidentUseCase real so we can assert instanceof
vi.mock('../../../packages/core/src/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    RedisDeduplicationStore: vi.fn().mockImplementation(() => ({ isDuplicate: vi.fn() })),
    LokiTraceRepository: vi.fn().mockImplementation(() => ({ findByFingerprint: vi.fn() })),
    createLLMProvider: vi.fn().mockReturnValue({ chat: vi.fn() }),
    SlackNotifier: vi.fn().mockImplementation(() => ({ notify: vi.fn() })),
  };
});

// Import under test — does NOT exist yet (RED)
import { createProcessIncidentUseCase, type ProcessIncidentDeps } from '../process-incident.factory.js';
import { ProcessIncidentUseCase } from '../../../packages/core/src/index.js';
import type { Config } from '../../../packages/core/src/index.js';
import type { Logger } from '../../../packages/core/src/index.js';

// ─── Test fixtures ───────────────────────────────────────────────────────────

const mockConfig = {
  logLevel: 'info',
  redisUrl: 'redis://localhost:6379',
  lokiUrl: 'http://localhost:3100',
  llmProvider: 'claude',
  llmApiKey: 'test-key',
  llmModel: 'claude-3-haiku',
  slackBotToken: 'xoxb-test',
  slackChannel: '#test-alerts',
  sqsQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/test',
  dedupTtlSeconds: 3600,
  environment: 'test',
} as unknown as Config;

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

function makeDeps(overrides: Partial<ProcessIncidentDeps> = {}): ProcessIncidentDeps {
  return {
    config: mockConfig,
    logger: mockLogger,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createProcessIncidentUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a ProcessIncidentUseCase instance when given valid deps', () => {
    const useCase = createProcessIncidentUseCase(makeDeps());

    expect(useCase).toBeInstanceOf(ProcessIncidentUseCase);
  });

  it('returns an instance with an execute method (behavioral check)', () => {
    const useCase = createProcessIncidentUseCase(makeDeps());

    expect(typeof useCase.execute).toBe('function');
  });

  it('throws if config is missing', () => {
    expect(() =>
      createProcessIncidentUseCase(makeDeps({ config: undefined as unknown as Config })),
    ).toThrow();
  });

  it('throws if logger is missing', () => {
    expect(() =>
      createProcessIncidentUseCase(makeDeps({ logger: undefined as unknown as Logger })),
    ).toThrow();
  });

  it('returns a distinct instance on each call (no shared singleton)', () => {
    const first = createProcessIncidentUseCase(makeDeps());
    const second = createProcessIncidentUseCase(makeDeps());

    expect(first).not.toBe(second);
    expect(first).toBeInstanceOf(ProcessIncidentUseCase);
    expect(second).toBeInstanceOf(ProcessIncidentUseCase);
  });
});
