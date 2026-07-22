import type { Config } from '../../shared/config/index.js';
import type { IRollbackActionHandler } from '../../domain/ports/index.js';
import { NoopRollbackActionHandler } from './noop-rollback-action.handler.js';

/**
 * Creates the rollback action handler for the application.
 *
 * In the first slice the factory always returns the no-op handler. Later slices
 * can add env-based selection (e.g. a custom handler registered via config).
 */
export function createRollbackActionHandler(_config: Config): IRollbackActionHandler {
  return new NoopRollbackActionHandler();
}
