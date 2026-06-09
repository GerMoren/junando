import type { INotifier } from '../../domain/ports/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// ChannelRegistry — Map<string, INotifier> for named channel resolution.
// No switch/case — pure Map-based lookup with fallback.
// ─────────────────────────────────────────────────────────────────────────────

export class ChannelRegistry {
  private readonly _channels = new Map<string, INotifier>();
  private _default: INotifier | null = null;

  /**
   * Register a notifier for a given channel name.
   * Overwrites any existing registration for that name.
   */
  register(channel: string, notifier: INotifier): void {
    this._channels.set(channel, notifier);
  }

  /**
   * Set the default notifier to use when a channel is not found.
   */
  setDefault(notifier: INotifier): void {
    this._default = notifier;
  }

  /**
   * Resolve a channel name to its notifier instance.
   * Falls back to the default notifier if the channel is unknown.
   *
   * @throws {Error} if the channel is unknown and no default is set
   */
  resolve(channel: string): INotifier {
    const instance = this._channels.get(channel);
    if (instance) {
      return instance;
    }
    if (this._default) {
      return this._default;
    }
    throw new Error(
      `Unknown channel "${channel}" and no default notifier configured`,
    );
  }

  /**
   * Check if a channel is registered.
   */
  has(channel: string): boolean {
    return this._channels.has(channel);
  }
}
