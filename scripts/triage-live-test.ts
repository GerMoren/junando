#!/usr/bin/env tsx
/**
 * triage-live-test.ts
 * Fires N real requests at a triage provider against the actual Vercel AI
 * Gateway (no mocks) and reports the severity distribution, latency stats,
 * and how many results fell back to 'medium' (the fail-open default).
 *
 * Usage:
 *   TRIAGE_PROVIDER=jev AI_GATEWAY_API_KEY=... \
 *     pnpm run test:triage:live -- --count 20
 *
 *   TRIAGE_PROVIDER=vercel-gateway TRIAGE_MODEL=meta/llama-3.1-8b AI_GATEWAY_API_KEY=... \
 *     pnpm run test:triage:live -- --count 20 --delay-ms 3000
 *
 * Provider notes:
 * - 'jev' (TypeSafe AI, via Vercel AI Gateway's Evaluation API — POST
 *   /v1/evaluate) is a purpose-built decision/scoring model. Confirmed live:
 *   fast (~150ms), correct, and free while in its promotional window.
 * - 'vercel-gateway' asks any chat-completions model in the Gateway's
 *   catalog for a single severity word. Reasoning/"thinking" models (e.g.
 *   qwen3's thinking variants) burn the whole max_tokens budget on their
 *   reasoning preamble and never emit the actual word — confirmed live
 *   against alibaba/qwen-3-14b, which returned empty `content` on every
 *   single call. Prefer a plain instruction-following model, e.g.
 *   meta/llama-3.1-8b.
 */
import { createTriageProvider } from "../packages/core/src/index.js";
import type { AlertCluster } from "../packages/core/src/index.js";
import { AlertType } from "../packages/core/src/shared/constants.js";

const args = process.argv.slice(2);
const countIndex = args.indexOf("--count");
const count = countIndex === -1 ? 10 : Number.parseInt(args[countIndex + 1] ?? "10", 10);

// Vercel AI Gateway's free/shared credentials enforce per-model rate limits
// (observed: 5 req/min for alibaba/qwen-3-14b via deepinfra). Pass
// --delay-ms to space requests out and avoid burning the whole run on 429s.
const delayIndex = args.indexOf("--delay-ms");
const delayMs = delayIndex === -1 ? 0 : Number.parseInt(args[delayIndex + 1] ?? "0", 10);

const apiKey = process.env["AI_GATEWAY_API_KEY"] ?? process.env["TRIAGE_API_KEY"];
const provider = process.env["TRIAGE_PROVIDER"] ?? "jev";
const model = process.env["TRIAGE_MODEL"] ?? "";

if (!apiKey) {
  console.error("Missing AI_GATEWAY_API_KEY (or TRIAGE_API_KEY) environment variable.");
  process.exit(1);
}
if (provider === "vercel-gateway" && !model) {
  console.error("TRIAGE_MODEL is required when TRIAGE_PROVIDER=vercel-gateway.");
  process.exit(1);
}

// A realistic-ish spread of clusters, cycling through them so a small --count
// still exercises different severities the classifier might reasonably assign.
const SAMPLE_CLUSTERS: AlertCluster[] = [
  {
    fingerprint: "live-test-1",
    serviceName: "payments-service",
    alertType: AlertType.Error,
    endpointPath: "/api/payments",
    alertCount: 12,
    representativeTraceIds: [],
    firstSeenAt: new Date().toISOString(),
    latencyP99Ms: 4200,
  },
  {
    fingerprint: "live-test-2",
    serviceName: "internal-batch-job",
    alertType: AlertType.Warning,
    endpointPath: "/internal/nightly-report",
    alertCount: 1,
    representativeTraceIds: [],
    firstSeenAt: new Date().toISOString(),
    latencyP99Ms: 300,
  },
  {
    fingerprint: "live-test-3",
    serviceName: "auth-service",
    alertType: AlertType.Error,
    endpointPath: "/api/auth/login",
    alertCount: 40,
    representativeTraceIds: [],
    firstSeenAt: new Date().toISOString(),
    latencyP99Ms: 9800,
  },
];

async function main() {
  const triage = createTriageProvider(provider, apiKey!, model);
  const results: { clusterName: string; severity: string; latencyMs: number }[] = [];

  console.log(
    `Firing ${count} live requests at provider "${provider}"${model ? ` (model "${model}")` : ""}...\n`,
  );

  for (let i = 0; i < count; i++) {
    const cluster = SAMPLE_CLUSTERS[i % SAMPLE_CLUSTERS.length]!;
    const startMs = Date.now();
    const result = await triage.classify(cluster);
    const latencyMs = Date.now() - startMs;
    results.push({ clusterName: cluster.serviceName, severity: result.severity, latencyMs });
    console.log(
      `[${i + 1}/${count}] ${cluster.serviceName.padEnd(20)} -> ${result.severity.toUpperCase().padEnd(9)} (${latencyMs}ms)`,
    );
    if (delayMs > 0 && i < count - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const distribution: Record<string, number> = {};
  for (const r of results) {
    distribution[r.severity] = (distribution[r.severity] ?? 0) + 1;
  }
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? latencies.at(-1);

  console.log("\n--- Summary ---");
  console.log("Severity distribution:", distribution);
  console.log(`Latency: avg=${avg.toFixed(0)}ms p50=${p50}ms p99=${p99}ms`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
