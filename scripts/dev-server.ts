#!/usr/bin/env tsx
/**
 * dev-server.ts
 * Wraps Lambda A handler in a plain Node.js HTTP server for local development.
 * Listens on :4000 and translates HTTP requests → APIGatewayProxyEventV2 shape.
 *
 * Usage: pnpm run dev:webhook
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createLogger, DEV_SERVER_PORT, RATE_LIMITER } from "@junando/core";
import Bottleneck from "bottleneck";

const logger = createLogger();

const limiter = new Bottleneck({
  minTime: RATE_LIMITER.MinTimeMs,
  maxConcurrent: RATE_LIMITER.MaxConcurrent,
});

process.env["NODE_ENV"] = "development";
process.env["SQS_QUEUE_URL"] = "";

const PORT = Number(process.env["PORT"] ?? DEV_SERVER_PORT);

/**
 * Lazily imports the handler module.
 * Uses dynamic import to support tsx watch mode hot-reload.
 * The handler is re-imported on each request to pick up file changes.
 */
async function getHandler(): Promise<(event: any) => Promise<any>> {
  const mod = await import("../packages/webhook/src/handler.js");
  return mod.handler;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function buildEvent(req: IncomingMessage, body: string) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  return {
    version: "2.0",
    routeKey: `${req.method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: req.headers as Record<string, string>,
    requestContext: {
      http: {
        method: req.method ?? "GET",
        path: url.pathname,
        sourceIp: "127.0.0.1",
      },
      requestId: randomUUID(),
    },
    body: body || undefined,
    isBase64Encoded: false,
  };
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const body = await readBody(req);
  const event = buildEvent(req, body);

  try {
    const handler = await getHandler();
    // Apply rate limiting
    const result = await limiter.schedule(() => handler(event as never));

    const statusCode =
      typeof result === "object" && result !== null && "statusCode" in result
        ? (result as { statusCode: number }).statusCode
        : 200;
    const responseBody =
      typeof result === "object" && result !== null && "body" in result
        ? (result as { body: string }).body
        : "";

    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(responseBody);
  } catch (err) {
    logger.error({ err }, "Handler error");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  logger.info(`🔦 Junando webhook running on http://localhost:${PORT}`);
  logger.info(`   POST /webhook/alert  → processes Alertmanager payload`);
  logger.info(`   GET  /health         → health check`);
  logger.info(`   Waiting for alerts...`);
});
