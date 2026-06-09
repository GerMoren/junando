// ─────────────────────────────────────────────────────────────────────────────
// FactoryRegistry — generic factory registry with string keys.
// No switch/case — register adapters by key, resolve by key.
// ─────────────────────────────────────────────────────────────────────────────

export class FactoryRegistry<T> {
  private readonly _factories = new Map<string, () => T>();
  private _default: () => T = () => {
    throw new Error(`No factory registered and no default available`);
  };

  /**
   * Register a factory for a given key.
   * Overwrites any existing registration for that key.
   */
  register(key: string, factory: () => T): void {
    this._factories.set(key, factory);
  }

  /**
   * Set the default factory to use when no key matches.
   */
  registerDefault(factory: () => T): void {
    this._default = factory;
  }

  /**
   * Resolve the factory for a given key.
   * Returns the default if no specific factory is registered for that key.
   */
  resolve(key: string): T {
    const factory = this._factories.get(key);
    if (factory) {
      return factory();
    }
    return this._default();
  }

  /**
   * Check if a factory is registered for a given key.
   */
  has(key: string): boolean {
    return this._factories.has(key);
  }

  /**
   * Return all registered keys.
   */
  keys(): string[] {
    return Array.from(this._factories.keys());
  }
}