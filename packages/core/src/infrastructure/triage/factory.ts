import type { ITriageProvider } from '../../domain/ports/index.js';
import { VercelGatewayTriageProvider } from './vercel-gateway-triage.provider.js';

/**
 * Factory for triage providers. Only 'vercel-gateway' is supported today —
 * the JEV backend remains future work (see GitHub issue #355).
 */
export function createTriageProvider(
  provider: string,
  apiKey: string,
  model: string,
): ITriageProvider {
  if (provider === 'vercel-gateway') {
    return new VercelGatewayTriageProvider(apiKey, model);
  }
  throw new Error(`Unknown TRIAGE_PROVIDER: "${provider}". Supported: vercel-gateway`);
}
