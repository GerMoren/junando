import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * buildEvent — pure function.
 * Converts an IncomingMessage + body string into an APIGatewayProxyEventV2-shaped object
 * that the webhook handler expects.
 */
export function buildEvent(req: IncomingMessage, body: string, port: number) {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  return {
    version: '2.0',
    routeKey: `${req.method ?? 'GET'} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: req.headers as Record<string, string>,
    requestContext: {
      http: {
        method: req.method ?? 'GET',
        path: url.pathname,
        sourceIp: '0.0.0.0',
      },
      requestId: randomUUID(),
    },
    body: body || undefined,
    isBase64Encoded: false,
  };
}
