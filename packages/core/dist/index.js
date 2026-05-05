// src/domain/entities/alert.ts
import { z } from "zod";
var AlertStatusSchema = z.enum(["firing", "resolved"]);
var NormalizedAlertSchema = z.object({
  alertName: z.string(),
  status: AlertStatusSchema,
  serviceName: z.string(),
  // fingerprint field #1
  errorType: z.string(),
  // fingerprint field #2
  endpointPath: z.string(),
  // fingerprint field #3
  traceId: z.string().optional(),
  startsAt: z.string().datetime(),
  latencyMs: z.number().optional(),
  labels: z.record(z.string()),
  annotations: z.record(z.string())
});
var AlertmanagerPayloadSchema = z.object({
  version: z.string().default("4"),
  groupKey: z.string(),
  truncatedAlerts: z.number().default(0),
  status: AlertStatusSchema,
  receiver: z.string(),
  groupLabels: z.record(z.string()),
  commonLabels: z.record(z.string()),
  commonAnnotations: z.record(z.string()),
  externalURL: z.string().url(),
  alerts: z.array(z.object({
    status: AlertStatusSchema,
    labels: z.record(z.string()),
    annotations: z.record(z.string()).default({}),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    fingerprint: z.string().optional()
  })).min(1)
});

// src/domain/entities/cluster.ts
import { z as z2 } from "zod";
var AlertClusterSchema = z2.object({
  fingerprint: z2.string(),
  serviceName: z2.string(),
  errorType: z2.string(),
  endpointPath: z2.string(),
  alertCount: z2.number().int().positive(),
  representativeTraceIds: z2.array(z2.string()).max(2),
  firstSeenAt: z2.string().datetime(),
  latencyP99Ms: z2.number().optional()
});

// src/domain/entities/incident.ts
import { z as z3 } from "zod";
var UrgencyLevelSchema = z3.enum(["low", "medium", "high", "critical"]);
var LLMAnalysisSchema = z3.object({
  probable_cause: z3.string().min(1),
  impacted_services: z3.array(z3.string()).min(1),
  recommended_steps: z3.array(z3.string()).min(1).max(5),
  urgency_level: UrgencyLevelSchema,
  requires_rollback: z3.boolean()
});
var IncidentSchema = z3.object({
  cluster: AlertClusterSchema,
  traces: z3.array(z3.record(z3.unknown())).optional(),
  analysis: LLMAnalysisSchema.optional(),
  // absent if LLM failed gracefully
  processedAt: z3.string().datetime()
});

// src/domain/value-objects/fingerprint.ts
import { createHash } from "crypto";
var Fingerprint = class _Fingerprint {
  constructor(value) {
    this.value = value;
  }
  value;
  static fromAlert(alert) {
    const input = [
      alert.serviceName.toLowerCase().trim(),
      alert.errorType.toLowerCase().trim(),
      alert.endpointPath.toLowerCase().trim()
    ].join("|");
    const hash = createHash("sha256").update(input).digest("hex");
    return new _Fingerprint(hash);
  }
  equals(other) {
    return this.value === other.value;
  }
  toString() {
    return this.value;
  }
};

// src/domain/services/clustering.service.ts
var ClusteringService = class {
  /**
   * Groups alerts by fingerprint and builds AlertCluster objects.
   * 300 alerts with the same root cause → 1 cluster with 2 representative traces.
   */
  buildClusters(alerts) {
    const groups = /* @__PURE__ */ new Map();
    for (const alert of alerts) {
      const fp = Fingerprint.fromAlert(alert).toString();
      const group = groups.get(fp) ?? [];
      group.push(alert);
      groups.set(fp, group);
    }
    return Array.from(groups.entries()).map(
      ([fp, group]) => this.buildCluster(fp, group)
    );
  }
  buildCluster(fingerprint, alerts) {
    const sorted = [...alerts].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
    const first = sorted[0];
    const traceIds = this.sampleTraceIds(alerts);
    const latencies = alerts.map((a) => a.latencyMs ?? 0);
    const p99 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)];
    return {
      fingerprint,
      serviceName: first.serviceName,
      errorType: first.errorType,
      endpointPath: first.endpointPath,
      alertCount: alerts.length,
      representativeTraceIds: traceIds,
      firstSeenAt: first.startsAt,
      latencyP99Ms: p99
    };
  }
  sampleTraceIds(alerts) {
    const withTraces = alerts.filter(
      (a) => typeof a.traceId === "string" && a.traceId.length > 0
    );
    if (withTraces.length === 0) return [];
    const sorted = [...withTraces].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
    const first = sorted[0];
    const slowest = withTraces.reduce(
      (max, a) => (a.latencyMs ?? 0) > (max.latencyMs ?? 0) ? a : max
    );
    return slowest.traceId !== first.traceId ? [first.traceId, slowest.traceId] : [first.traceId];
  }
};

// src/application/use-cases/process-incident.use-case.ts
var ProcessIncidentUseCase = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  clustering = new ClusteringService();
  async execute(alerts, correlationId) {
    const { dedup, traces, llm, notifier, logger, dedupTtlSeconds } = this.deps;
    const log = logger.child({ correlationId, useCase: "ProcessIncident" });
    log.info({ alertCount: alerts.length }, "Processing alert batch");
    const clusters = this.clustering.buildClusters(alerts);
    log.info({ clusterCount: clusters.length }, "Clusters built");
    for (const cluster of clusters) {
      const log2 = log.child({ fingerprint: cluster.fingerprint, service: cluster.serviceName });
      const isNew = await dedup.isNew(cluster.fingerprint, dedupTtlSeconds);
      if (!isNew) {
        log2.debug("Duplicate cluster \u2014 skipping");
        continue;
      }
      const spanLists = await Promise.all(
        cluster.representativeTraceIds.map(
          (id) => traces.findByTraceId(id).catch((err) => {
            log2.warn({ err, traceId: id }, "Trace fetch failed \u2014 continuing without it");
            return [];
          })
        )
      );
      const allSpans = spanLists.flat();
      log2.info({ spanCount: allSpans.length }, "Traces extracted");
      let analysis = null;
      try {
        analysis = await llm.analyze(cluster, allSpans);
        log2.info({ urgency: analysis.urgency_level }, "LLM analysis complete");
      } catch (err) {
        log2.warn({ err }, "LLM inference failed \u2014 notifying without diagnosis");
      }
      try {
        await notifier.send(cluster, analysis);
        log2.info("Notification sent");
      } catch (err) {
        log2.error({ err }, "Notification failed");
        throw err;
      }
    }
  }
};

// src/application/dtos/normalize-payload.ts
function normalizePayload(payload) {
  return payload.alerts.filter((a) => a.status === "firing").map((a) => ({
    alertName: a.labels["alertname"] ?? "unknown",
    status: a.status,
    serviceName: a.labels["service"] ?? a.labels["job"] ?? "unknown-service",
    errorType: a.labels["error_type"] ?? a.labels["alertname"] ?? "unknown-error",
    endpointPath: a.labels["endpoint"] ?? a.annotations["endpoint"] ?? "/",
    traceId: a.labels["trace_id"] ?? a.annotations["trace_id"],
    startsAt: a.startsAt,
    latencyMs: a.labels["latency_ms"] ? Number(a.labels["latency_ms"]) : void 0,
    labels: a.labels,
    annotations: a.annotations
  }));
}

// src/infrastructure/dedup/redis-dedup.adapter.ts
var RedisDeduplicationStore = class {
  constructor(redis) {
    this.redis = redis;
  }
  redis;
  keyPrefix = "junando:dedup:";
  async isNew(fingerprint, ttlSeconds) {
    try {
      const result = await this.redis.set(
        `${this.keyPrefix}${fingerprint}`,
        "1",
        "EX",
        ttlSeconds,
        "NX"
      );
      return result === "OK";
    } catch {
      return true;
    }
  }
  async reset(fingerprint) {
    await this.redis.del(`${this.keyPrefix}${fingerprint}`);
  }
};
var InMemoryDeduplicationStore = class {
  store = /* @__PURE__ */ new Map();
  // fingerprint → expiry timestamp
  async isNew(fingerprint, ttlSeconds) {
    const expiry = this.store.get(fingerprint);
    const now = Date.now();
    if (expiry !== void 0 && expiry > now) return false;
    this.store.set(fingerprint, now + ttlSeconds * 1e3);
    return true;
  }
  async reset(fingerprint) {
    this.store.delete(fingerprint);
  }
  clear() {
    this.store.clear();
  }
};

// src/infrastructure/traces/loki-trace.adapter.ts
var LokiTraceRepository = class {
  constructor(lokiUrl, apiKey) {
    this.lokiUrl = lokiUrl;
    this.apiKey = apiKey;
  }
  lokiUrl;
  apiKey;
  async findByTraceId(traceId) {
    const query = encodeURIComponent(`{trace_id="${traceId}"}`);
    const url = `${this.lokiUrl}/loki/api/v1/query_range?query=${query}&limit=50`;
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Loki query failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    return this.parseResponse(body);
  }
  parseResponse(body) {
    return body.data.result.flatMap(
      (stream) => stream.values.map(([ts, line]) => ({
        timestamp: ts,
        ...this.tryParseJSON(line)
      }))
    );
  }
  tryParseJSON(line) {
    try {
      return JSON.parse(line);
    } catch {
      return { message: line };
    }
  }
};
var MockTraceRepository = class {
  constructor(fixtures = /* @__PURE__ */ new Map()) {
    this.fixtures = fixtures;
  }
  fixtures;
  async findByTraceId(traceId) {
    return this.fixtures.get(traceId) ?? [];
  }
  addFixture(traceId, spans) {
    this.fixtures.set(traceId, spans);
  }
};

// src/infrastructure/llm/llm.adapter.ts
var SYSTEM_PROMPT = `You are a senior Site Reliability Engineer performing incident triage.
Analyze the following alert cluster and trace excerpts.
Respond ONLY with a valid JSON object matching this exact schema \u2014 no markdown, no explanation:
{
  "probable_cause": "string",
  "impacted_services": ["string"],
  "recommended_steps": ["string (max 5 items)"],
  "urgency_level": "low" | "medium" | "high" | "critical",
  "requires_rollback": boolean
}`;
function buildUserPrompt(cluster, traces) {
  return [
    `## Alert Cluster`,
    `Service: ${cluster.serviceName}`,
    `Error type: ${cluster.errorType}`,
    `Endpoint: ${cluster.endpointPath}`,
    `Alert count: ${cluster.alertCount}`,
    `First seen: ${cluster.firstSeenAt}`,
    cluster.latencyP99Ms ? `P99 latency: ${cluster.latencyP99Ms}ms` : "",
    ``,
    `## Representative Traces (${traces.length} spans)`,
    JSON.stringify(traces.slice(0, 30), null, 2)
    // hard cap — never exceed token budget
  ].filter(Boolean).join("\n");
}
function parseAnalysis(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return LLMAnalysisSchema.parse(JSON.parse(cleaned));
}
var GeminiProvider = class {
  constructor(apiKey, model = "gemini-1.5-flash") {
    this.apiKey = apiKey;
    this.model = model;
  }
  apiKey;
  model;
  async analyze(cluster, traces) {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const gemini = genAI.getGenerativeModel({ model: this.model, systemInstruction: SYSTEM_PROMPT });
    const result = await gemini.generateContent(buildUserPrompt(cluster, traces));
    return parseAnalysis(result.response.text());
  }
};
var ClaudeProvider = class {
  constructor(apiKey, model = "claude-haiku-4-5") {
    this.apiKey = apiKey;
    this.model = model;
  }
  apiKey;
  model;
  async analyze(cluster, traces) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: this.apiKey });
    const message = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(cluster, traces) }]
    });
    const text = message.content.find((b) => b.type === "text")?.text ?? "";
    return parseAnalysis(text);
  }
};
var MockLLMProvider = class {
  callLog = [];
  async analyze(cluster, _traces) {
    this.callLog.push({ cluster });
    return {
      probable_cause: `Mock: ${cluster.errorType} on ${cluster.serviceName}`,
      impacted_services: [cluster.serviceName],
      recommended_steps: ["Check the logs", "Verify the deployment"],
      urgency_level: "high",
      requires_rollback: false
    };
  }
};
function createLLMProvider(provider, apiKey, model) {
  switch (provider) {
    case "gemini":
      return new GeminiProvider(apiKey, model);
    case "claude":
      return new ClaudeProvider(apiKey, model);
    default:
      throw new Error(`Unknown LLM_PROVIDER: "${provider}". Supported: gemini, claude`);
  }
}

// src/infrastructure/notifier/slack.adapter.ts
var URGENCY_EMOJI = {
  critical: "\u{1F534}",
  high: "\u{1F7E0}",
  medium: "\u{1F7E1}",
  low: "\u{1F7E2}"
};
var SlackNotifier = class {
  constructor(botToken, channel) {
    this.botToken = botToken;
    this.channel = channel;
  }
  botToken;
  channel;
  async send(cluster, analysis) {
    const payload = analysis ? this.buildAnalysisMessage(cluster, analysis) : this.buildFallbackMessage(cluster);
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.botToken}`
      },
      body: JSON.stringify({ channel: this.channel, ...payload })
    });
    if (!res.ok) throw new Error(`Slack API error: ${res.status}`);
    const body = await res.json();
    if (!body.ok) throw new Error(`Slack error: ${body.error}`);
  }
  buildAnalysisMessage(cluster, analysis) {
    const emoji = URGENCY_EMOJI[analysis.urgency_level] ?? "\u26AA";
    const steps = analysis.recommended_steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    return {
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${emoji} Incident \u2014 ${cluster.serviceName}` }
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Service*
${cluster.serviceName}` },
            { type: "mrkdwn", text: `*Alerts*
${cluster.alertCount}` },
            { type: "mrkdwn", text: `*Endpoint*
\`${cluster.endpointPath}\`` },
            { type: "mrkdwn", text: `*Urgency*
${emoji} ${analysis.urgency_level.toUpperCase()}` }
          ]
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Probable cause*
${analysis.probable_cause}` }
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Recommended steps*
${steps}` }
        },
        { type: "divider" },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "\u2705 Acknowledge" },
              style: "primary",
              action_id: "acknowledge",
              value: cluster.fingerprint
            },
            ...analysis.requires_rollback ? [{
              type: "button",
              text: { type: "plain_text", text: "\u23EA Trigger Rollback" },
              style: "danger",
              action_id: "trigger_rollback",
              value: cluster.fingerprint,
              confirm: {
                title: { type: "plain_text", text: "Confirm rollback" },
                text: { type: "plain_text", text: `Roll back ${cluster.serviceName}?` },
                confirm: { type: "plain_text", text: "Yes, rollback" },
                deny: { type: "plain_text", text: "Cancel" }
              }
            }] : []
          ]
        }
      ]
    };
  }
  buildFallbackMessage(cluster) {
    return {
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `\u26A0\uFE0F Incident \u2014 ${cluster.serviceName} (no AI diagnosis)` }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${cluster.alertCount} alerts* on \`${cluster.endpointPath}\` since ${cluster.firstSeenAt}
LLM analysis unavailable \u2014 manual investigation required.`
          }
        }
      ]
    };
  }
};
var ConsoleNotifier = class {
  sent = [];
  async send(cluster, analysis) {
    this.sent.push({ cluster, analysis });
    console.log("\n--- Junando Notification ---");
    console.log("Cluster:", cluster.serviceName, cluster.errorType);
    console.log("Analysis:", analysis ?? "unavailable");
    console.log("----------------------------\n");
  }
};

// src/shared/logger/index.ts
import pino from "pino";
function createLogger(level = "info") {
  return pino({
    level,
    base: { service: "junando" },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

// src/shared/config/index.ts
import { z as z4 } from "zod";
var ConfigSchema = z4.object({
  llmProvider: z4.enum(["gemini", "claude"]),
  llmApiKey: z4.string().min(1),
  llmModel: z4.string().optional(),
  slackBotToken: z4.string().startsWith("xoxb-"),
  slackSigningSecret: z4.string().min(1),
  slackChannel: z4.string().startsWith("#"),
  lokiUrl: z4.string().url(),
  redisUrl: z4.string().url(),
  sqsQueueUrl: z4.string().url().optional(),
  dedupTtlSeconds: z4.coerce.number().int().positive().default(300),
  clusterWindowMs: z4.coerce.number().int().positive().default(12e4),
  logLevel: z4.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  nodeEnv: z4.enum(["development", "test", "production"]).default("development")
});
function loadConfig() {
  const result = ConfigSchema.safeParse({
    llmProvider: process.env["LLM_PROVIDER"],
    llmApiKey: process.env["LLM_API_KEY"],
    llmModel: process.env["LLM_MODEL"],
    slackBotToken: process.env["SLACK_BOT_TOKEN"],
    slackSigningSecret: process.env["SLACK_SIGNING_SECRET"],
    slackChannel: process.env["SLACK_CHANNEL"],
    lokiUrl: process.env["LOKI_URL"],
    redisUrl: process.env["REDIS_URL"],
    sqsQueueUrl: process.env["SQS_QUEUE_URL"],
    dedupTtlSeconds: process.env["DEDUP_TTL_SECONDS"],
    clusterWindowMs: process.env["CLUSTER_WINDOW_MS"],
    logLevel: process.env["LOG_LEVEL"],
    nodeEnv: process.env["NODE_ENV"]
  });
  if (!result.success) {
    console.error("\u274C Invalid configuration:");
    result.error.issues.forEach((issue) => {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    });
    process.exit(1);
  }
  return result.data;
}
export {
  AlertClusterSchema,
  AlertStatusSchema,
  AlertmanagerPayloadSchema,
  ClaudeProvider,
  ClusteringService,
  ConsoleNotifier,
  Fingerprint,
  GeminiProvider,
  InMemoryDeduplicationStore,
  IncidentSchema,
  LLMAnalysisSchema,
  LokiTraceRepository,
  MockLLMProvider,
  MockTraceRepository,
  NormalizedAlertSchema,
  ProcessIncidentUseCase,
  RedisDeduplicationStore,
  SlackNotifier,
  UrgencyLevelSchema,
  createLLMProvider,
  createLogger,
  loadConfig,
  normalizePayload
};
