import type { Component, Outcome } from './enums.js';

// ─────────────────────────────────────────────────────────────────────────────
// WideEvent — one canonical structured log line per processing unit.
//
// Entry points (webhook, worker, ingest) create a WideEventBuilder at request
// start; pipeline stages accumulate results into it; flush() emits the final
// event. Unset optional fields are omitted from the output.
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum serialized event size: 256 KB. Events beyond this are truncated. */
const MAX_EVENT_BYTES = 256 * 1024;

/**
 * Per-string cap applied when an event exceeds MAX_EVENT_BYTES.
 * ~256 strings × 1 KB would still fit; real events have far fewer fields.
 */
const OVERSIZED_STRING_CAP = 1024;

export interface ClusterSection {
  fingerprint: string;
  serviceName: string;
  alertCount: number;
  spanCount: number;
  /** Number of representative traces that failed to fetch (fail-open). */
  traceErrors?: number;
}

export interface DedupSection {
  isNew: boolean;
  ttlSeconds: number;
  /** Fail-open error message when the store was unreachable (e.g. Redis down). */
  error?: string;
}

export interface RuleSection {
  matched: boolean;
  suppressed: boolean;
  /** ID of the rule that matched, when the engine reports one. */
  matchedRuleId?: string;
}

export interface LlmSection {
  provider: string;
  model: string;
  latencyMs: number;
  urgency: string;
  tokens: number;
}

export interface NotifySection {
  channels: string[];
  outcome: string;
  latencyMs: number;
}

export interface RollbackSection {
  actionId: string;
  channel: string;
  outcome: 'ok' | 'error';
  handlerMessage: string;
}

export interface ErrorSection {
  message: string;
  name?: string;
  stack?: string;
}

export interface WideEvent {
  requestId: string;
  correlationId?: string;
  timestamp: string;
  component: Component;
  version?: string;
  outcome?: Outcome;
  cluster?: ClusterSection;
  dedup?: DedupSection;
  rule?: RuleSection;
  llm?: LlmSection;
  notify?: NotifySection;
  rollback?: RollbackSection;
  durationMs?: number;
  error?: ErrorSection;
  /** Present only when the 256 KB guard truncated the event. */
  _truncated?: boolean;
}

/** Fields the builder owns — callers cannot set or merge them. */
type BuilderOwnedKey = 'requestId' | 'component' | 'timestamp' | '_truncated';

/** Keys callers may write via set()/merge(). */
type SettableKey = Exclude<keyof WideEvent, BuilderOwnedKey>;

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function shrinkStrings(value: unknown, cap: number): unknown {
  if (typeof value === 'string') {
    return value.length > cap ? value.slice(0, cap) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => shrinkStrings(item, cap));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shrinkStrings(item, cap)]),
    );
  }
  return value;
}

export class WideEventBuilder {
  private fields: Partial<WideEvent> = {};

  constructor(
    private readonly requestId: string,
    private readonly component: Component,
  ) {}

  set<K extends SettableKey>(key: K, value: WideEvent[K]): this {
    this.fields = { ...this.fields, [key]: value };
    return this;
  }

  merge(obj: Partial<WideEvent>): this {
    const { requestId: _r, component: _c, timestamp: _t, _truncated: _x, ...rest } = obj;
    this.fields = { ...this.fields, ...rest };
    return this;
  }

  flush(): WideEvent {
    const event: WideEvent = {
      requestId: this.requestId,
      component: this.component,
      timestamp: new Date().toISOString(),
      ...this.fields,
    };
    return this.enforceSizeLimit(event);
  }

  private enforceSizeLimit(event: WideEvent): WideEvent {
    if (serializedBytes(event) <= MAX_EVENT_BYTES) {
      return event;
    }
    const shrunk = shrinkStrings(event, OVERSIZED_STRING_CAP) as WideEvent;
    return { ...shrunk, _truncated: true };
  }
}
