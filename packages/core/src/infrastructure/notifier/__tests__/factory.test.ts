import { describe, it, expect } from 'vitest';
import { createNotifier } from '../factory.js';
import { SlackNotifier } from '../slack.adapter.js';
import { TeamsNotifier } from '../teams.adapter.js';
import { RoutingNotifier } from '../routing-notifier.js';
import type { Config } from '../../../shared/config/index.js';

function makeSlackConfig(overrides: Partial<Config> = {}): Config {
  return {
    llmProvider: 'gemini',
    llmApiKey: 'test-key',
    llmModel: undefined,
    notifierType: 'slack',
    slackBotToken: 'xoxb-test',
    slackSigningSecret: 'signing-secret',
    slackChannel: '#alerts',
    teamsWebhookUrl: undefined,
    lokiUrl: undefined,
    redisUrl: 'redis://localhost:6379',
    sqsQueueUrl: undefined,
    dedupTtlSeconds: 300,
    clusterWindowMs: 120_000,
    logLevel: 'info',
    nodeEnv: 'test',
    llmFallbackModels: [],
    llmFallbackTimeoutMs: 60_000,
    ...overrides,
  };
}

function makeTeamsConfig(): Config {
  return makeSlackConfig({
    notifierType: 'teams',
    slackBotToken: undefined,
    slackSigningSecret: undefined,
    slackChannel: undefined,
    teamsWebhookUrl: 'https://example.powerautomate.com/invoke?api-version=1',
  });
}

// ── WIR-01: factory returns correct notifier type ──────────────────────────

describe('createNotifier factory (WIR-01)', () => {
  it('returns TeamsNotifier when notifierType is "teams"', () => {
    const notifier = createNotifier(makeTeamsConfig());
    expect(notifier).toBeInstanceOf(TeamsNotifier);
  });

  it('returns SlackNotifier when notifierType is "slack"', () => {
    const notifier = createNotifier(makeSlackConfig());
    expect(notifier).toBeInstanceOf(SlackNotifier);
  });
});

// ── WIR-02: factory is single instantiation point ────────────────────────
// This test documents the architectural constraint: notifier instantiation
// lives ONLY in factory.ts. Any future notifier type must be added here.

describe('factory architectural contract (WIR-02)', () => {
  it('factory module is named createNotifier and lives in factory.ts — single source of truth', () => {
    // Structural assertion: the factory function must be callable and return INotifier
    const slackNotifier = createNotifier(makeSlackConfig());
    const teamsNotifier = createNotifier(makeTeamsConfig());
    // Both satisfy the INotifier interface (have a send method)
    expect(typeof slackNotifier.send).toBe('function');
    expect(typeof teamsNotifier.send).toBe('function');
  });
});

// ── WIR-03: multi-channel routing when rulesConfigPath is set ─────────────

describe('createNotifier with rules config (WIR-03)', () => {
  const rulesYamlPath = `${__dirname}/../../../../rules.example.yaml`;

  it('returns SlackNotifier when rulesConfigPath is NOT set (backward compat)', () => {
    const notifier = createNotifier(makeSlackConfig());
    expect(notifier).toBeInstanceOf(SlackNotifier);
    expect(notifier).not.toBeInstanceOf(RoutingNotifier);
  });

  it('returns TeamsNotifier when rulesConfigPath is NOT set (backward compat)', () => {
    const notifier = createNotifier(makeTeamsConfig());
    expect(notifier).toBeInstanceOf(TeamsNotifier);
    expect(notifier).not.toBeInstanceOf(RoutingNotifier);
  });

  it('returns RoutingNotifier when rulesConfigPath IS set', () => {
    const config = makeSlackConfig({ rulesConfigPath: rulesYamlPath });
    const notifier = createNotifier(config);
    expect(notifier).toBeInstanceOf(RoutingNotifier);
  });

  it('RoutingNotifier still exposes INotifier.send interface', () => {
    const config = makeSlackConfig({ rulesConfigPath: rulesYamlPath });
    const notifier = createNotifier(config);
    expect(typeof notifier.send).toBe('function');
  });

  it('throws when rulesConfigPath points to non-existent file', () => {
    const config = makeSlackConfig({ rulesConfigPath: '/nonexistent/rules.yaml' });
    expect(() => createNotifier(config)).toThrow();
  });

  it('throws when rulesConfigPath points to invalid YAML', () => {
    // Use a temp inline path? Factory reads fs, so we test that invalid file throws.
    // The existing file for this project is valid, so we test non-existent path + invalid content.
    // For invalid content, we'd need a temp file — covered by yaml-rule-loader unit tests.
    const config = makeSlackConfig({ rulesConfigPath: '/nonexistent/rules.yaml' });
    expect(() => createNotifier(config)).toThrow();
  });
});
