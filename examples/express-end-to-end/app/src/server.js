import express from "express";
import client from "prom-client";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import pino from "pino";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = express();

// --- correlationId middleware ----------------------------------------------
// Propagates an incoming x-correlation-id header or generates one. Every log
// line, every metric label, and every error response carries this id so that
// a single incident is traceable end-to-end from app -> Prom -> Junando -> Slack.
app.use((req, res, next) => {
  const id = req.header("x-correlation-id") ?? randomUUID();
  req.correlationId = id;
  res.setHeader("x-correlation-id", id);
  next();
});

app.use(
  pinoHttp({
    logger: log,
    customProps: (req) => ({ correlationId: req.correlationId }),
  }),
);

// --- Prometheus metrics ----------------------------------------------------
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled by the demo app",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

const httpErrors = new client.Counter({
  name: "http_errors_total",
  help: "Total HTTP 5xx responses from the demo app",
  labelNames: ["route"],
  registers: [register],
});

// --- Routes ----------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/orders/:id", (req, res) => {
  httpRequests.inc({ method: "GET", route: "/api/orders/:id", status: 200 });
  res.json({ id: req.params.id, status: "shipped" });
});

// Intentionally broken endpoint. Every call returns 500 and increments
// http_errors_total. Prometheus alert rule (see prometheus/rules.yml) fires
// when the rate exceeds the threshold.
app.get("/api/checkout", (req, res) => {
  req.log.error(
    { correlationId: req.correlationId, route: "/api/checkout" },
    "checkout failed: payment provider unreachable",
  );
  httpRequests.inc({ method: "GET", route: "/api/checkout", status: 500 });
  httpErrors.inc({ route: "/api/checkout" });
  res.status(500).json({
    error: "payment_provider_unreachable",
    correlationId: req.correlationId,
  });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, "0.0.0.0", () => {
  log.info({ port }, "demo-app listening");
});
