import type { ITriageProvider } from '../../domain/ports/index.js';
import { JevTriageProvider } from './jev-triage.provider.js';
import { VercelGatewayTriageProvider } from './vercel-gateway-triage.provider.js';

/**
 * Factory for triage providers.
 * - 'jev' uses TypeSafe AI's Jev via Vercel AI Gateway's Evaluation API
 *   (POST /v1/evaluate) — a purpose-built decision/scoring model.
 * - 'vercel-gateway' uses any chat-completions-capable model in the
 *   Gateway's catalog, asked to answer with a single severity word.
 */
export function createTriageProvider(
  provider: string,
  apiKey: string,
  model: string,
): ITriageProvider {
  if (provider === 'jev') {
    return new JevTriageProvider(apiKey);
  }
  if (provider === 'vercel-gateway') {
    return new VercelGatewayTriageProvider(apiKey, model);
  }
  throw new Error(`Unknown TRIAGE_PROVIDER: "${provider}". Supported: jev, vercel-gateway`);
}
