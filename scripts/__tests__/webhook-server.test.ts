import { describe, it, expect } from 'vitest';
import { buildEvent } from '../http-utils.js';
import type { IncomingMessage } from 'node:http';

// buildEvent: pure function — converts IncomingMessage + body → APIGatewayProxyEventV2 shape
// Tests run against production code that does NOT exist yet (RED)

function makeReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    method: 'POST',
    url: '/webhook',
    headers: { 'content-type': 'application/json', host: 'localhost' },
    ...overrides,
  } as unknown as IncomingMessage;
}

describe('buildEvent', () => {
  it('maps POST /webhook to APIGatewayProxyEventV2 shape', () => {
    const req = makeReq({ method: 'POST', url: '/webhook' });
    const event = buildEvent(req, '{"foo":"bar"}', 4000);

    expect(event.version).toBe('2.0');
    expect(event.routeKey).toBe('POST /webhook');
    expect(event.rawPath).toBe('/webhook');
    expect(event.body).toBe('{"foo":"bar"}');
    expect(event.isBase64Encoded).toBe(false);
  });

  it('sets body to undefined when body string is empty', () => {
    const req = makeReq({ method: 'GET', url: '/health' });
    const event = buildEvent(req, '', 4000);

    expect(event.body).toBeUndefined();
    expect(event.rawPath).toBe('/health');
    expect(event.routeKey).toBe('GET /health');
  });

  it('includes a non-empty requestId for tracing', () => {
    const req = makeReq();
    const event = buildEvent(req, '', 4000);

    expect(typeof event.requestContext.requestId).toBe('string');
    expect(event.requestContext.requestId.length).toBeGreaterThan(0);
  });

  it('parses query string from URL', () => {
    const req = makeReq({ url: '/health?verbose=true' });
    const event = buildEvent(req, '', 4000);

    expect(event.rawQueryString).toBe('verbose=true');
  });
});
