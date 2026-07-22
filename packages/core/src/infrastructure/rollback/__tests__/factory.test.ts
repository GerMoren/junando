import { describe, it, expect } from 'vitest';
import { createRollbackActionHandler } from '../factory.js';
import { NoopRollbackActionHandler } from '../noop-rollback-action.handler.js';
import type { Config } from '../../../shared/config/index.js';

describe('createRollbackActionHandler', () => {
  it('returns the no-op handler in the first slice', () => {
    const handler = createRollbackActionHandler({} as Config);
    expect(handler).toBeInstanceOf(NoopRollbackActionHandler);
  });
});
