import type { IRollbackActionHandler, RollbackActionRequest, RollbackActionResult } from '../../domain/ports/index.js';
import { createLogger } from '../../shared/logger/index.js';

const logger = createLogger();

/**
 * Default rollback action handler.
 *
 * Logs the request and returns success so teams without a custom deployment
 * pipeline still see a safe, predictable behavior when the rollback button is
 * clicked. Never throws.
 */
export class NoopRollbackActionHandler implements IRollbackActionHandler {
  async handle(request: RollbackActionRequest): Promise<RollbackActionResult> {
    logger.info(
      {
        fingerprint: request.fingerprint,
        serviceName: request.serviceName,
        endpointPath: request.endpointPath,
        alertType: request.alertType,
        urgencyLevel: request.urgencyLevel,
        triggeredBy: request.triggeredBy,
        correlationId: request.correlationId,
        messageTs: request.messageTs,
      },
      'Rollback action received; no handler configured.',
    );

    return {
      ok: true,
      message: 'Rollback action logged; no handler configured.',
    };
  }
}
