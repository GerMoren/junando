/**
 * webhook-server.ts
 * Production HTTP entrypoint for the Junando webhook service.
 * Wraps packages/webhook handler in a Node.js HTTP server.
 *
 * Handler is imported once at startup (not per-request).
 * Graceful SIGTERM: drains in-flight requests before exit.
 */
import {
  createLogger,
  DEV_SERVER_PORT,
  flushLoki,
  loadConfig,
  RATE_LIMITER,
  reinitLogger,
} from "@junando/core";
import Bottleneck from "bottleneck";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { buildEvent } from "./http-utils.js";

export { buildEvent };

type WebhookHandler = (event: unknown) => Promise<unknown>;

const logger = createLogger();

const limiter = new Bottleneck({
  minTime: RATE_LIMITER.MinTimeMs,
  maxConcurrent: RATE_LIMITER.MaxConcurrent,
});

let _handler: WebhookHandler | undefined;

async function getHandler(): Promise<WebhookHandler> {
  if (!_handler) {
    const mod = await import("../packages/webhook/src/handler.js");
    // NOSONAR S4325: cast IS necessary — mod.handler expects APIGatewayProxyEventV2,
    // but we feed it a structurally compatible subset built from a Node IncomingMessage.
    _handler = mod.handler as WebhookHandler;
  }
  return _handler;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const PORT = Number(process.env["PORT"] ?? DEV_SERVER_PORT);

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const body = await readBody(req);
  const event = buildEvent(req, body, PORT);

  try {
    const handler = await getHandler();
    const result = await limiter.schedule(() => handler(event));

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
  } finally {
    await flushLoki();
  }
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received — closing server");
  server.close(async () => {
    await flushLoki();
    process.exit(0);
  });
});

const config = await loadConfig();
reinitLogger({ level: config.logLevel });

await new Promise<void>((resolve) => {
  server.listen(PORT, () => {
    logger.info(`Junando webhook running on http://localhost:${PORT}`);
    resolve();
  });
});
