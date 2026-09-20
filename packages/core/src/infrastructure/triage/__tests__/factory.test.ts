import { describe, it, expect } from 'vitest';
import { createTriageProvider } from '../factory.js';
import { JevTriageProvider } from '../jev-triage.provider.js';
import { VercelGatewayTriageProvider } from '../vercel-gateway-triage.provider.js';

describe('createTriageProvider', () => {
  it('creates a JevTriageProvider for "jev"', () => {
    const provider = createTriageProvider('jev', 'key', '');
    expect(provider).toBeInstanceOf(JevTriageProvider);
  });

  it('creates a VercelGatewayTriageProvider for "vercel-gateway"', () => {
    const provider = createTriageProvider('vercel-gateway', 'key', 'meta/llama-3.1-8b');
    expect(provider).toBeInstanceOf(VercelGatewayTriageProvider);
  });

  it('throws on an unknown provider', () => {
    expect(() => createTriageProvider('unknown', 'key', 'model')).toThrow(
      'Unknown TRIAGE_PROVIDER: "unknown". Supported: jev, vercel-gateway',
    );
  });
});
