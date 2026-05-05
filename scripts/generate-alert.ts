#!/usr/bin/env tsx
const WEBHOOK_URL =
  process.env["WEBHOOK_URL"] ?? "http://localhost:4000/webhook/alert";
const args = process.argv.slice(2);
const serviceIndex = args.indexOf("--service");
const service =
  serviceIndex === -1 ? "payments-service" : args[serviceIndex + 1];

const countIndex = args.indexOf("--count");
const count = countIndex === -1 ? 3 : Number.parseInt(args[countIndex + 1], 10);

const typeIndex = args.indexOf("--type");
const type = typeIndex === -1 ? "error" : args[typeIndex + 1]; // error, warning, success

const getAlertConfig = (type: string, i: number, count: number) => {
  switch (type) {
    case "warning":
      return {
        alertname: "HighLatency",
        severity: "warning",
        error_type: "latency_spike",
        summary: `High latency detected on ${service} — alert ${i + 1}/${count}`,
      };
    case "success":
      return {
        alertname: "ServiceRecovered",
        severity: "info",
        error_type: "recovery",
        summary: `Service ${service} has recovered and is operating normally — alert ${i + 1}/${count}`,
      };
    case "error":
    default:
      return {
        alertname: "HighErrorRate",
        severity: "critical",
        error_type: "http_500",
        summary: `High error rate on ${service} — alert ${i + 1}/${count}`,
      };
  }
};

const firstAlertConfig = getAlertConfig(type, 0, count);

const payload = {
  version: "4",
  groupKey: `{}:{alertname="${firstAlertConfig.alertname}"}`,
  truncatedAlerts: 0,
  status: type === "success" ? "resolved" : "firing",
  receiver: "junando",
  groupLabels: { alertname: firstAlertConfig.alertname },
  commonLabels: { severity: firstAlertConfig.severity },
  commonAnnotations: {},
  externalURL: "http://localhost:9093",
  alerts: Array.from({ length: count }, (_, i) => {
    const config = getAlertConfig(type, i, count);
    return {
      status: type === "success" ? "resolved" : "firing",
      labels: {
        alertname: config.alertname,
        service,
        error_type: config.error_type,
        endpoint: "/api/payments",
        severity: config.severity,
      },
      annotations: {
        summary: config.summary,
      },
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      fingerprint: Math.random().toString(36).slice(2),
    };
  }),
};

async function main() {
  console.log(
    `🚨 Junando — firing ${count} [${type.toUpperCase()}] alerts for ${service}`,
  );
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log(
    res.ok ? `✅ Accepted (${res.status})` : `❌ Rejected (${res.status})`,
  );
}

main().catch(console.error);
