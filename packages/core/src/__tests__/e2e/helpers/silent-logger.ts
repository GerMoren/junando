import pino from 'pino';
import type { Logger } from '../../../shared/logger/index.js';

/**
 * silentLogger — a real pino logger configured to write nothing. Avoids
 * polluting vitest output while keeping the production Logger interface
 * (which is pino.Logger, including .child()).
 */
export const silentLogger: Logger = pino({ level: 'silent' });
