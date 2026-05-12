#!/usr/bin/env tsx
/**
 * generate-alert.ts
 * Fires synthetic Alertmanager webhooks to the local dev server for testing.
 *
 * Usage:
 *   pnpm run generate:alert
 *   pnpm run generate:alert -- --service payments-service --count 5 --type error
 */
import {
  ALERT_TYPE_LABELS,
  AlertType,
  HOUR_MS,
  PAYLOAD_DEFAULTS,
  WEBHOOK_DEFAULTS,
} from "../packages/core/src/shared/constants.js";
import { createLogger } from "../packages/core/src/shared/logger/index.js";

const logger = createLogger();
const WEBHOOK_URL = process.env["JUNANDO_WEBHOOK_URL"] ?? WEBHOOK_DEFAULTS.WebhookUrl;

const args = process.argv.slice(2);

const serviceIndex = args.indexOf("--service");
const service =
  serviceIndex === -1 ? "payments-service" : (args[serviceIndex + 1] ?? "payments-service");

const countIndex = args.indexOf("--count");
const count = countIndex === -1 ? 3 : Number.parseInt(args[countIndex + 1] ?? "3", 10);

const typeIndex = args.indexOf("--type");
const rawType = typeIndex === -1 ? "error" : (args[typeIndex + 1] ?? "error");

const ALERT_TYPE_MAP: ReadonlyMap<string, AlertType> = new Map([
  ["error", AlertType.Error],
  ["warning", AlertType.Warning],
  ["success", AlertType.Success],
]);

const alertType = ALERT_TYPE_MAP.get(rawType) ?? AlertType.Error;
const labelConfig = ALERT_TYPE_LABELS[alertType];
const isResolved = alertType === AlertType.Success;

const firstConfig = labelConfig.summary(service, 1, count);

const payload = {
  version: PAYLOAD_DEFAULTS.Version,
  groupKey: `{}:{alertname="${labelConfig.alertName}"}`,
  truncatedAlerts: PAYLOAD_DEFAULTS.TruncatedAlerts,
  status: isResolved ? "resolved" : "firing",
  receiver: PAYLOAD_DEFAULTS.Receiver,
  groupLabels: { alertname: labelConfig.alertName },
  commonLabels: { severity: labelConfig.severity },
  commonAnnotations: {},
  externalURL: WEBHOOK_DEFAULTS.AlertmanagerUrl,
  alerts: Array.from({ length: count }, (_, i) => ({
    status: isResolved ? "resolved" : "firing",
    labels: {
      alertname: labelConfig.alertName,
      service,
      error_type: alertType,
      endpoint: "/api/payments",
      severity: labelConfig.severity,
    },
    annotations: {
      summary: labelConfig.summary(service, i + 1, count),
    },
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + HOUR_MS).toISOString(),
    fingerprint: Math.random().toString(36).slice(2),
  })),
};

async function main() {
  logger.info({ count, alertType: rawType.toUpperCase(), service }, "Firing alerts to webhook");
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  logger.info({ status: res.status, ok: res.ok }, "Webhook response received");
  if (!res.ok) {
    const body = await res.text();
    logger.error({ status: res.status, body }, "Webhook request failed");
  }
}

try {
  await main();
} catch (err: any) {
  if (err.code === "ECONNREFUSED") {
    logger.fatal(
      { err, url: WEBHOOK_URL },
      "Connection refused. Is the webhook server running? If you are testing AWS, set WEBHOOK_URL environment variable.",
    );
  } else {
    logger.fatal({ err }, "Fatal error in generate-alert");
  }
  process.exit(1);
}
