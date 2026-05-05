#!/usr/bin/env tsx
const WEBHOOK_URL =
  process.env["WEBHOOK_URL"] ?? "http://localhost:4000/webhook/alert";
const args = process.argv.slice(2);
const service = args[args.indexOf("--service") + 1] ?? "payments-service";
const count = Number.parseInt(args[args.indexOf("--count") + 1] ?? "3", 10);

const payload = {
  version: "4",
  groupKey: `{}:{alertname="HighErrorRate"}`,
  truncatedAlerts: 0,
  status: "firing",
  receiver: "junando",
  groupLabels: { alertname: "HighErrorRate" },
  commonLabels: { severity: "critical" },
  commonAnnotations: {},
  externalURL: "http://localhost:9093",
  alerts: Array.from({ length: count }, (_, i) => ({
    status: "firing",
    labels: {
      alertname: "HighErrorRate",
      service,
      error_type: "http_500",
      endpoint: "/api/payments",
      severity: "critical",
    },
    annotations: {
      summary: `High error rate on ${service} — alert ${i + 1}/${count}`,
    },
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    fingerprint: Math.random().toString(36).slice(2),
  })),
};

async function main() {
  console.log(`🚨 Junando — firing ${count} alerts for ${service}`);
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
