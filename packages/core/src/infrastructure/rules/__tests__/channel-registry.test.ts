import { describe, it, expect, vi } from 'vitest';
import type { INotifier } from '../../../domain/ports/index.js';

// Import the class under test — does NOT exist yet (RED)
import { ChannelRegistry } from '../channel-registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: RED phase — tests written FIRST. channel-registry.ts does NOT exist yet.
// ─────────────────────────────────────────────────────────────────────────────

function createMockNotifier(_name: string): INotifier {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  } as unknown as INotifier & { _name: string };
}

describe('ChannelRegistry', () => {
  it('register adds a notifier to the registry', () => {
    const registry = new ChannelRegistry();
    const slack = createMockNotifier('slack');
    registry.register('slack-sre', slack);
    expect(registry.has('slack-sre')).toBe(true);
  });

  it('resolve returns the registered notifier for a known channel', () => {
    const registry = new ChannelRegistry();
    const slack = createMockNotifier('slack');
    registry.register('slack-sre', slack);
    expect(registry.resolve('slack-sre')).toBe(slack);
  });

  it('resolve falls back to default for unknown channel', () => {
    const registry = new ChannelRegistry();
    const fallback = createMockNotifier('fallback');
    registry.setDefault(fallback);
    expect(registry.resolve('unknown-channel')).toBe(fallback);
  });

  it('resolve throws when no default is set and channel is unknown', () => {
    const registry = new ChannelRegistry();
    expect(() => registry.resolve('nonexistent')).toThrow();
  });

  it('register overwrites existing channel registration', () => {
    const registry = new ChannelRegistry();
    const first = createMockNotifier('first');
    const second = createMockNotifier('second');
    registry.register('alerts', first);
    registry.register('alerts', second);
    expect(registry.resolve('alerts')).toBe(second);
  });

  it('has returns false for unregistered channel', () => {
    const registry = new ChannelRegistry();
    expect(registry.has('missing')).toBe(false);
  });

  it('supports multiple channels in the same registry', () => {
    const registry = new ChannelRegistry();
    const slack = createMockNotifier('slack');
    const teams = createMockNotifier('teams');
    const pd = createMockNotifier('pagerduty');

    registry.register('slack-sre', slack);
    registry.register('teams-devops', teams);
    registry.register('pagerduty-critical', pd);

    expect(registry.resolve('slack-sre')).toBe(slack);
    expect(registry.resolve('teams-devops')).toBe(teams);
    expect(registry.resolve('pagerduty-critical')).toBe(pd);
  });
});
