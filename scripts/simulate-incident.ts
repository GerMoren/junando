#!/usr/bin/env tsx
import { createLogger } from "@junando/core";
import { randomUUID } from "node:crypto";

const logger = createLogger();

const args = process.argv.slice(2);
const scenarioArg = args.find((a) => a.startsWith("--scenario="));
const scenario = scenarioArg?.split("=")[1] ?? "db_outage";

const targetArg = args.find((a) => a.startsWith("--target="));
const target = targetArg?.split("=")[1] ?? "local";

const serviceArg = args.find((a) => a.startsWith("--service="));
const service = serviceArg?.split("=")[1] ?? "orders-service";

const useMock = args.includes("--mock");

/**
 * Scenario configuration for incident simulation.
 * Defines alert parameters for different incident types.
 */
interface Scenario {
  alertname: string;
  severity: string;
  error_type: string;
  summary: string;
  endpoint: string;
  count: number;
}

const SCENARIOS: Record<string, Scenario> = {
  db_outage: {
    alertname: "DatabaseConnectionError",
    severity: "critical",
    error_type: "db_timeout",
    summary: "Connection pool exhausted while connecting to postgres-prod",
    endpoint: "/api/v1/checkout",
    count: 12,
  },
  bad_deploy: {
    alertname: "HighErrorRate",
    severity: "critical",
    error_type: "http_500",
    summary: "Internal Server Error after v1.2.4 deploy",
    endpoint: "/api/v1/user/profile",
    count: 5,
  },
  latency_spike: {
    alertname: "SlowResponses",
    severity: "warning",
    error_type: "latency_ms",
    summary: "P99 latency above 2s in us-east-1",
    endpoint: "/api/v1/search",
    count: 8,
  },
};

const selectedScenario = SCENARIOS[scenario] || SCENARIOS.db_outage;
if (!selectedScenario) {
  throw new Error(`Scenario ${scenario} not found and no fallback available`);
}
const config = selectedScenario;

const payload = {
  version: "4",
  groupKey: `{}:{alertname="${config.alertname}"}`,
  status: "firing",
  receiver: "junando",
  groupLabels: { alertname: config.alertname },
  commonLabels: { severity: config.severity },
  commonAnnotations: {},
  externalURL: "http://localhost:9093",
  alerts: Array.from({ length: config.count }, (_, i) => ({
    status: "firing",
    labels: {
      alertname: config.alertname,
      service,
      error_type: config.error_type,
      endpoint: config.endpoint,
      severity: config.severity,
      instance: `pod-${i}`,
      region: "us-east-1",
    },
    annotations: {
      summary: config.summary,
      description: `Detailed log: ${config.error_type} detected on instance pod-${i}. Stacktrace: ...`,
    },
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    fingerprint: randomUUID().slice(0, 8),
  })),
};

async function run() {
  logger.info({ scenario, service }, "Simulating scenario");

  if (target === "webhook") {
    const url =
      process.env["JUNANDO_WEBHOOK_URL"] ??
      process.env["WEBHOOK_URL"] ??
      "http://localhost:4000/webhook/alert";
    logger.info({ url }, "Sending to Webhook");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      logger.info("Accepted by webhook");
    } else {
      logger.error({ status: res.status, error: await res.text() }, "Failed to send");
    }
  } else {
    // Local processing (calling worker-local logic)
    const { spawn } = await import("node:child_process");
    const tmpPath = `./tmp/scenario-${scenario}.json`;
    const fs = await import("node:fs/promises");

    await fs.mkdir("./tmp", { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2));

    logger.info({ tmpPath, useMock }, "Processing locally with worker-local");
    const workerArgs = ["--env-file=.env.local", "scripts/worker-local.ts", "--file", tmpPath];
    if (useMock) workerArgs.push("--mock");

    const worker = spawn("tsx", workerArgs, {
      stdio: "inherit",
    });

    worker.on("close", (code) => {
      if (code === 0) logger.info("Scenario completed successfully");
      else logger.error({ code }, "Scenario failed");
    });
  }
}

run().catch((err) => logger.fatal({ err }, "Simulation fatal error"));
