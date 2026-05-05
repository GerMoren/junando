import { z } from 'zod';
import pino from 'pino';
import { Redis } from 'ioredis';

declare const AlertStatusSchema: z.ZodEnum<["firing", "resolved"]>;
declare const NormalizedAlertSchema: z.ZodObject<{
    alertName: z.ZodString;
    status: z.ZodEnum<["firing", "resolved"]>;
    serviceName: z.ZodString;
    errorType: z.ZodString;
    endpointPath: z.ZodString;
    traceId: z.ZodOptional<z.ZodString>;
    startsAt: z.ZodString;
    latencyMs: z.ZodOptional<z.ZodNumber>;
    labels: z.ZodRecord<z.ZodString, z.ZodString>;
    annotations: z.ZodRecord<z.ZodString, z.ZodString>;
}, "strip", z.ZodTypeAny, {
    alertName: string;
    status: "firing" | "resolved";
    serviceName: string;
    errorType: string;
    endpointPath: string;
    startsAt: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    traceId?: string | undefined;
    latencyMs?: number | undefined;
}, {
    alertName: string;
    status: "firing" | "resolved";
    serviceName: string;
    errorType: string;
    endpointPath: string;
    startsAt: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    traceId?: string | undefined;
    latencyMs?: number | undefined;
}>;
declare const AlertmanagerPayloadSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodString>;
    groupKey: z.ZodString;
    truncatedAlerts: z.ZodDefault<z.ZodNumber>;
    status: z.ZodEnum<["firing", "resolved"]>;
    receiver: z.ZodString;
    groupLabels: z.ZodRecord<z.ZodString, z.ZodString>;
    commonLabels: z.ZodRecord<z.ZodString, z.ZodString>;
    commonAnnotations: z.ZodRecord<z.ZodString, z.ZodString>;
    externalURL: z.ZodString;
    alerts: z.ZodArray<z.ZodObject<{
        status: z.ZodEnum<["firing", "resolved"]>;
        labels: z.ZodRecord<z.ZodString, z.ZodString>;
        annotations: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        startsAt: z.ZodString;
        endsAt: z.ZodString;
        fingerprint: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "firing" | "resolved";
        startsAt: string;
        labels: Record<string, string>;
        annotations: Record<string, string>;
        endsAt: string;
        fingerprint?: string | undefined;
    }, {
        status: "firing" | "resolved";
        startsAt: string;
        labels: Record<string, string>;
        endsAt: string;
        annotations?: Record<string, string> | undefined;
        fingerprint?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    status: "firing" | "resolved";
    version: string;
    groupKey: string;
    truncatedAlerts: number;
    receiver: string;
    groupLabels: Record<string, string>;
    commonLabels: Record<string, string>;
    commonAnnotations: Record<string, string>;
    externalURL: string;
    alerts: {
        status: "firing" | "resolved";
        startsAt: string;
        labels: Record<string, string>;
        annotations: Record<string, string>;
        endsAt: string;
        fingerprint?: string | undefined;
    }[];
}, {
    status: "firing" | "resolved";
    groupKey: string;
    receiver: string;
    groupLabels: Record<string, string>;
    commonLabels: Record<string, string>;
    commonAnnotations: Record<string, string>;
    externalURL: string;
    alerts: {
        status: "firing" | "resolved";
        startsAt: string;
        labels: Record<string, string>;
        endsAt: string;
        annotations?: Record<string, string> | undefined;
        fingerprint?: string | undefined;
    }[];
    version?: string | undefined;
    truncatedAlerts?: number | undefined;
}>;
type AlertStatus = z.infer<typeof AlertStatusSchema>;
type NormalizedAlert = z.infer<typeof NormalizedAlertSchema>;
type AlertmanagerPayload = z.infer<typeof AlertmanagerPayloadSchema>;

declare const AlertClusterSchema: z.ZodObject<{
    fingerprint: z.ZodString;
    serviceName: z.ZodString;
    errorType: z.ZodString;
    endpointPath: z.ZodString;
    alertCount: z.ZodNumber;
    representativeTraceIds: z.ZodArray<z.ZodString, "many">;
    firstSeenAt: z.ZodString;
    latencyP99Ms: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    serviceName: string;
    errorType: string;
    endpointPath: string;
    fingerprint: string;
    alertCount: number;
    representativeTraceIds: string[];
    firstSeenAt: string;
    latencyP99Ms?: number | undefined;
}, {
    serviceName: string;
    errorType: string;
    endpointPath: string;
    fingerprint: string;
    alertCount: number;
    representativeTraceIds: string[];
    firstSeenAt: string;
    latencyP99Ms?: number | undefined;
}>;
type AlertCluster = z.infer<typeof AlertClusterSchema>;

declare const UrgencyLevelSchema: z.ZodEnum<["low", "medium", "high", "critical"]>;
declare const LLMAnalysisSchema: z.ZodObject<{
    probable_cause: z.ZodString;
    impacted_services: z.ZodArray<z.ZodString, "many">;
    recommended_steps: z.ZodArray<z.ZodString, "many">;
    urgency_level: z.ZodEnum<["low", "medium", "high", "critical"]>;
    requires_rollback: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    probable_cause: string;
    impacted_services: string[];
    recommended_steps: string[];
    urgency_level: "low" | "medium" | "high" | "critical";
    requires_rollback: boolean;
}, {
    probable_cause: string;
    impacted_services: string[];
    recommended_steps: string[];
    urgency_level: "low" | "medium" | "high" | "critical";
    requires_rollback: boolean;
}>;
declare const IncidentSchema: z.ZodObject<{
    cluster: z.ZodObject<{
        fingerprint: z.ZodString;
        serviceName: z.ZodString;
        errorType: z.ZodString;
        endpointPath: z.ZodString;
        alertCount: z.ZodNumber;
        representativeTraceIds: z.ZodArray<z.ZodString, "many">;
        firstSeenAt: z.ZodString;
        latencyP99Ms: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        serviceName: string;
        errorType: string;
        endpointPath: string;
        fingerprint: string;
        alertCount: number;
        representativeTraceIds: string[];
        firstSeenAt: string;
        latencyP99Ms?: number | undefined;
    }, {
        serviceName: string;
        errorType: string;
        endpointPath: string;
        fingerprint: string;
        alertCount: number;
        representativeTraceIds: string[];
        firstSeenAt: string;
        latencyP99Ms?: number | undefined;
    }>;
    traces: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
    analysis: z.ZodOptional<z.ZodObject<{
        probable_cause: z.ZodString;
        impacted_services: z.ZodArray<z.ZodString, "many">;
        recommended_steps: z.ZodArray<z.ZodString, "many">;
        urgency_level: z.ZodEnum<["low", "medium", "high", "critical"]>;
        requires_rollback: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        probable_cause: string;
        impacted_services: string[];
        recommended_steps: string[];
        urgency_level: "low" | "medium" | "high" | "critical";
        requires_rollback: boolean;
    }, {
        probable_cause: string;
        impacted_services: string[];
        recommended_steps: string[];
        urgency_level: "low" | "medium" | "high" | "critical";
        requires_rollback: boolean;
    }>>;
    processedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    cluster: {
        serviceName: string;
        errorType: string;
        endpointPath: string;
        fingerprint: string;
        alertCount: number;
        representativeTraceIds: string[];
        firstSeenAt: string;
        latencyP99Ms?: number | undefined;
    };
    processedAt: string;
    traces?: Record<string, unknown>[] | undefined;
    analysis?: {
        probable_cause: string;
        impacted_services: string[];
        recommended_steps: string[];
        urgency_level: "low" | "medium" | "high" | "critical";
        requires_rollback: boolean;
    } | undefined;
}, {
    cluster: {
        serviceName: string;
        errorType: string;
        endpointPath: string;
        fingerprint: string;
        alertCount: number;
        representativeTraceIds: string[];
        firstSeenAt: string;
        latencyP99Ms?: number | undefined;
    };
    processedAt: string;
    traces?: Record<string, unknown>[] | undefined;
    analysis?: {
        probable_cause: string;
        impacted_services: string[];
        recommended_steps: string[];
        urgency_level: "low" | "medium" | "high" | "critical";
        requires_rollback: boolean;
    } | undefined;
}>;
type UrgencyLevel = z.infer<typeof UrgencyLevelSchema>;
type LLMAnalysis = z.infer<typeof LLMAnalysisSchema>;
type Incident = z.infer<typeof IncidentSchema>;

declare class Fingerprint {
    readonly value: string;
    private constructor();
    static fromAlert(alert: NormalizedAlert): Fingerprint;
    equals(other: Fingerprint): boolean;
    toString(): string;
}

/**
 * Deduplication store.
 * Determines whether an alert fingerprint is new within a rolling TTL window.
 * Implementations: RedisDeduplicationStore, InMemoryDeduplicationStore (tests)
 */
interface IDeduplicationStore {
    isNew(fingerprint: string, ttlSeconds: number): Promise<boolean>;
    reset(fingerprint: string): Promise<void>;
}
/**
 * Alert queue.
 * Publishes normalized alerts for async processing.
 * Implementations: SQSAlertQueue, BullMQAlertQueue, InMemoryAlertQueue (tests)
 */
interface IAlertQueue {
    publish(alert: NormalizedAlert): Promise<void>;
}
/**
 * Trace repository.
 * Fetches distributed trace context by trace ID.
 * Implementations: LokiTraceRepository, DatadogTraceRepository, MockTraceRepository (tests)
 */
interface ITraceRepository {
    findByTraceId(traceId: string): Promise<Record<string, unknown>[]>;
}
/**
 * LLM provider.
 * Analyzes an incident cluster and returns a structured diagnosis.
 * Implementations: GeminiProvider, ClaudeProvider, OpenAIProvider, MockLLMProvider (tests)
 */
interface ILLMProvider {
    analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMAnalysis>;
}
/**
 * Notifier.
 * Delivers incident diagnoses to a ChatOps channel.
 * Implementations: SlackNotifier, TeamsNotifier, ConsoleNotifier (local dev/tests)
 */
interface INotifier {
    send(cluster: AlertCluster, analysis: LLMAnalysis | null): Promise<void>;
}

declare class ClusteringService {
    /**
     * Groups alerts by fingerprint and builds AlertCluster objects.
     * 300 alerts with the same root cause → 1 cluster with 2 representative traces.
     */
    buildClusters(alerts: NormalizedAlert[]): AlertCluster[];
    private buildCluster;
    private sampleTraceIds;
}

type Logger = pino.Logger;
declare function createLogger(level?: string): Logger;

interface Dependencies {
    dedup: IDeduplicationStore;
    traces: ITraceRepository;
    llm: ILLMProvider;
    notifier: INotifier;
    logger: Logger;
    dedupTtlSeconds: number;
}
declare class ProcessIncidentUseCase {
    private readonly deps;
    private clustering;
    constructor(deps: Dependencies);
    execute(alerts: NormalizedAlert[], correlationId: string): Promise<void>;
}

declare function normalizePayload(payload: AlertmanagerPayload): NormalizedAlert[];

declare class RedisDeduplicationStore implements IDeduplicationStore {
    private readonly redis;
    private readonly keyPrefix;
    constructor(redis: Redis);
    isNew(fingerprint: string, ttlSeconds: number): Promise<boolean>;
    reset(fingerprint: string): Promise<void>;
}
declare class InMemoryDeduplicationStore implements IDeduplicationStore {
    private store;
    isNew(fingerprint: string, ttlSeconds: number): Promise<boolean>;
    reset(fingerprint: string): Promise<void>;
    clear(): void;
}

declare class LokiTraceRepository implements ITraceRepository {
    private readonly lokiUrl;
    private readonly apiKey?;
    constructor(lokiUrl: string, apiKey?: string | undefined);
    findByTraceId(traceId: string): Promise<Record<string, unknown>[]>;
    private parseResponse;
    private tryParseJSON;
}
declare class MockTraceRepository implements ITraceRepository {
    private readonly fixtures;
    constructor(fixtures?: Map<string, Record<string, unknown>[]>);
    findByTraceId(traceId: string): Promise<Record<string, unknown>[]>;
    addFixture(traceId: string, spans: Record<string, unknown>[]): void;
}

declare class GeminiProvider implements ILLMProvider {
    private readonly apiKey;
    private readonly model;
    constructor(apiKey: string, model?: string);
    analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMAnalysis>;
}
declare class ClaudeProvider implements ILLMProvider {
    private readonly apiKey;
    private readonly model;
    constructor(apiKey: string, model?: string);
    analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMAnalysis>;
}
declare class MockLLMProvider implements ILLMProvider {
    readonly callLog: Array<{
        cluster: AlertCluster;
    }>;
    analyze(cluster: AlertCluster, _traces: Record<string, unknown>[]): Promise<LLMAnalysis>;
}
declare function createLLMProvider(provider: string, apiKey: string, model?: string): ILLMProvider;

declare class SlackNotifier implements INotifier {
    private readonly botToken;
    private readonly channel;
    constructor(botToken: string, channel: string);
    send(cluster: AlertCluster, analysis: LLMAnalysis | null): Promise<void>;
    private buildAnalysisMessage;
    private buildFallbackMessage;
}
declare class ConsoleNotifier implements INotifier {
    readonly sent: Array<{
        cluster: AlertCluster;
        analysis: LLMAnalysis | null;
    }>;
    send(cluster: AlertCluster, analysis: LLMAnalysis | null): Promise<void>;
}

declare const ConfigSchema: z.ZodObject<{
    llmProvider: z.ZodEnum<["gemini", "claude"]>;
    llmApiKey: z.ZodString;
    llmModel: z.ZodOptional<z.ZodString>;
    slackBotToken: z.ZodString;
    slackSigningSecret: z.ZodString;
    slackChannel: z.ZodString;
    lokiUrl: z.ZodString;
    redisUrl: z.ZodString;
    sqsQueueUrl: z.ZodOptional<z.ZodString>;
    dedupTtlSeconds: z.ZodDefault<z.ZodNumber>;
    clusterWindowMs: z.ZodDefault<z.ZodNumber>;
    logLevel: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error"]>>;
    nodeEnv: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
}, "strip", z.ZodTypeAny, {
    dedupTtlSeconds: number;
    llmProvider: "gemini" | "claude";
    llmApiKey: string;
    slackBotToken: string;
    slackSigningSecret: string;
    slackChannel: string;
    lokiUrl: string;
    redisUrl: string;
    clusterWindowMs: number;
    logLevel: "error" | "warn" | "info" | "debug" | "trace";
    nodeEnv: "development" | "test" | "production";
    llmModel?: string | undefined;
    sqsQueueUrl?: string | undefined;
}, {
    llmProvider: "gemini" | "claude";
    llmApiKey: string;
    slackBotToken: string;
    slackSigningSecret: string;
    slackChannel: string;
    lokiUrl: string;
    redisUrl: string;
    dedupTtlSeconds?: number | undefined;
    llmModel?: string | undefined;
    sqsQueueUrl?: string | undefined;
    clusterWindowMs?: number | undefined;
    logLevel?: "error" | "warn" | "info" | "debug" | "trace" | undefined;
    nodeEnv?: "development" | "test" | "production" | undefined;
}>;
type Config = z.infer<typeof ConfigSchema>;
declare function loadConfig(): Config;

export { type AlertCluster, AlertClusterSchema, type AlertStatus, AlertStatusSchema, type AlertmanagerPayload, AlertmanagerPayloadSchema, ClaudeProvider, ClusteringService, type Config, ConsoleNotifier, Fingerprint, GeminiProvider, type IAlertQueue, type IDeduplicationStore, type ILLMProvider, type INotifier, type ITraceRepository, InMemoryDeduplicationStore, type Incident, IncidentSchema, type LLMAnalysis, LLMAnalysisSchema, type Logger, LokiTraceRepository, MockLLMProvider, MockTraceRepository, type NormalizedAlert, NormalizedAlertSchema, ProcessIncidentUseCase, RedisDeduplicationStore, SlackNotifier, type UrgencyLevel, UrgencyLevelSchema, createLLMProvider, createLogger, loadConfig, normalizePayload };
