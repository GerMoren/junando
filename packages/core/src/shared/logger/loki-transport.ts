// ─────────────────────────────────────────────────────────────────────────────
// LokiBuffer — synchronous in-process Loki transport for Lambda.
//
// pino-abstract-transport runs in a worker_thread that Lambda kills before
// the fetch completes. This module buffers log entries in-process and flushes
// them in a single HTTP request at the END of the handler, before Lambda exits.
//
// Usage:
//   1. LokiBuffer captures pino log lines via a WritableStream destination.
//   2. At the end of the handler, call `flushLoki()` to push all buffered logs.
// ─────────────────────────────────────────────────────────────────────────────

import { Writable } from 'node:stream';

interface LokiConfig {
  host: string;
  username: string;
  password: string;
  labels: Record<string, string>;
}

interface LokiStream {
  stream: Record<string, string>;
  values: [string, string][];
}

/**
 * Maximum number of buffered log entries before the oldest is dropped.
 *
 * Acts as a ring buffer to prevent memory leaks if `flushLoki()` is never called
 * (e.g. a new handler forgets to wire it in) or if Loki pushes fail repeatedly.
 * When the buffer is full, the oldest entry is dropped to keep memory bounded.
 *
 * 1000 lines × ~1KB/line ≈ 1MB worst case, well within Lambda memory limits.
 */
const MAX_BUFFER_ENTRIES = 1000;

let _config: LokiConfig | null = null;
const _buffer: [string, string][] = []; // [nanosTimestamp, line]

/**
 * Initialize the Loki buffer with connection config.
 * Call this once after loadConfig() sets LOKI_URL.
 */
export function initLokiBuffer(config: LokiConfig): void {
  _config = config;
  _buffer.length = 0;
}

/**
 * Returns a pino-compatible Writable destination that buffers log lines.
 * Pass this as the second argument to pino().
 */
export function createLokiDestination(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        const line = chunk.toString().trim();
        if (!line) {
          callback();
          return;
        }
        // Loki requires nanosecond timestamps as STRINGS.
        // pino can emit `time` as either ISO string (isoTime) or number (epochTime).
        // Handle both, and fall back to Date.now() if missing/unparseable.
        let tsNs: string;
        try {
          const parsed = JSON.parse(line) as { time?: number | string };
          let ms = Date.now();
          if (typeof parsed.time === 'number' && Number.isFinite(parsed.time)) {
            ms = parsed.time;
          } else if (typeof parsed.time === 'string') {
            const parsedMs = Date.parse(parsed.time);
            if (Number.isFinite(parsedMs)) ms = parsedMs;
          }
          tsNs = String(ms * 1_000_000);
        } catch {
          tsNs = String(Date.now() * 1_000_000);
        }
        // Ring buffer: drop oldest entry when full to prevent unbounded growth.
        if (_buffer.length >= MAX_BUFFER_ENTRIES) {
          _buffer.shift();
        }
        _buffer.push([tsNs, line]);
      } catch {
        // never fail the logger
      }
      callback();
    },
    objectMode: false,
  });
}

/**
 * Flush all buffered log entries to Loki in a single HTTP request.
 * Call this at the END of the Lambda handler, after all business logic completes.
 * Errors are swallowed — Loki is best-effort; CloudWatch is the primary sink.
 */
export async function flushLoki(): Promise<void> {
  if (!_config || _buffer.length === 0) return;

  const { host, username, password, labels } = _config;
  const values = [..._buffer];
  _buffer.length = 0;

  const stream: LokiStream = { stream: labels, values };

  try {
    const res = await fetch(`${host}/loki/api/v1/push`, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      },
      body: JSON.stringify({ streams: [stream] }),
    });
    if (!res.ok) {
      process.stderr.write(`[junando] Loki flush failed: ${res.status} ${await res.text()}\n`);
    }
  } catch (err) {
    process.stderr.write(`[junando] Loki flush error: ${(err as Error).message}\n`);
  }
}
