import { AlertType, NormalizedAlertSchema } from '@junando/core';
import type { NormalizedAlert } from '@junando/core';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// CSV Input Adapter
// Auto-detects CSV body in SQS messages and parses into NormalizedAlert[].
// Falls back to JSON when body is not valid CSV.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Column mapping configuration for CSV parsing.
 * Defaults match common monitoring tool output (Prometheus, Datadog, etc.)
 */
export interface CsvColumnMapping {
  /** Column index (0-based) or header name for service name */
  serviceCol: number | string;
  /** Column index or header name for alert message */
  messageCol: number | string;
  /** Column index or header name for severity (maps to AlertType) */
  severityCol: number | string;
  /** Column index or header name for timestamp (ISO 8601) */
  timestampCol: number | string;
  /** Optional: column index or header name for fingerprint */
  fingerprintCol?: number | string;
  /** Optional: column index or header name for endpoint/path */
  endpointCol?: number | string;
  /** Optional: extra labels as key=col or key=col,key=col */
  extraLabels?: string;
}

/** Default column mapping — expects columns in order: service, message, severity, timestamp */
export const DEFAULT_CSV_COLUMN_MAPPING: CsvColumnMapping = {
  serviceCol: 0,
  messageCol: 1,
  severityCol: 2,
  timestampCol: 3,
};

/** Severity string to AlertType mapping */
const SEVERITY_TO_ALERT_TYPE: Record<string, AlertType> = {
  error: AlertType.Error,
  critical: AlertType.Error,
  high: AlertType.Error,
  warning: AlertType.Warning,
  warn: AlertType.Warning,
  latency: AlertType.Warning,
  success: AlertType.Success,
  recovery: AlertType.Success,
  resolved: AlertType.Success,
  info: AlertType.Success,
};

/** Schema for validated CSV → SQS message output */
const CsvParsedMessageSchema = z.object({
  correlationId: z.string().uuid(),
  alerts: z.array(NormalizedAlertSchema),
});

export type CsvParsedMessage = z.infer<typeof CsvParsedMessageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Detection & Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if `body` looks like CSV rather than JSON.
 * Heuristic: valid JSON starts with `{` or `[`, CSV starts with text and has commas.
 */
export function isCsvBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  // JSON marker
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  // Must have commas and at least one newline (multi-row) or multiple columns (single-row)
  return trimmed.includes(',') && (trimmed.includes('\n') || trimmed.split(',').length >= 3);
}

/**
 * Parse a CSV body into NormalizedAlert[] using the provided column mapping.
 * Returns null if parsing fails.
 */
export function parseCsvBody(
  body: string,
  mapping: CsvColumnMapping = DEFAULT_CSV_COLUMN_MAPPING,
): CsvParsedMessage | null {
  const lines = body.trim().split('\n');
  if (lines.length < 2) return null; // Need header + at least one data row

  const headerLine = lines[0]!;
  const headers = parseRow(headerLine);

  const alerts: NormalizedAlert[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i]!;
    const values = parseRow(row);
    if (values.length === 0) continue;

    try {
      const service = getColumnValue(headers, values, mapping.serviceCol);
      const message = getColumnValue(headers, values, mapping.messageCol);
      const severity = getColumnValue(headers, values, mapping.severityCol);
      const timestamp = getColumnValue(headers, values, mapping.timestampCol);
      const fingerprint =
        mapping.fingerprintCol != null
          ? getColumnValue(headers, values, mapping.fingerprintCol) || generateFingerprint(service, message)
          : generateFingerprint(service, message);
      const endpoint =
        mapping.endpointCol != null ? getColumnValue(headers, values, mapping.endpointCol) || '/' : '/';

      if (!service || !message || !severity || !timestamp) continue;

      const alertType = mapSeverityToAlertType(severity);
      if (!alertType) continue;

      const alert: NormalizedAlert = {
        fingerprint,
        alertName: message.slice(0, 200), // truncate long names
        status: 'firing',
        serviceName: service.trim(),
        alertType,
        endpointPath: endpoint.trim() || '/',
        startsAt: normalizeTimestamp(timestamp),
        labels: parseExtraLabels(mapping.extraLabels),
        annotations: { source: 'csv-adapter' },
      };

      // Validate with Zod
      const result = NormalizedAlertSchema.safeParse(alert);
      if (result.success) {
        alerts.push(result.data);
      }
    } catch {
      // Skip malformed rows
      continue;
    }
  }

  if (alerts.length === 0) return null;

  return {
    correlationId: crypto.randomUUID(),
    alerts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a single CSV row, respecting quoted fields */
function parseRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Get column value by index (number) or header name (string) */
function getColumnValue(headers: string[], values: string[], col: number | string): string {
  if (typeof col === 'number') {
    return values[col] ?? '';
  }
  const idx = headers.indexOf(col);
  return idx >= 0 ? values[idx] ?? '' : '';
}

/** Map severity string to AlertType, returns null if unrecognised */
function mapSeverityToAlertType(severity: string): AlertType | null {
  const lower = severity.toLowerCase().trim();
  return SEVERITY_TO_ALERT_TYPE[lower] ?? null;
}

/** Normalize various timestamp formats to ISO 8601 */
function normalizeTimestamp(value: string): string {
  const trimmed = value.trim();
  // Already ISO 8601
  if (/\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed;
  // Unix timestamp (seconds)
  if (/^\d{10}$/.test(trimmed)) {
    return new Date(Number(trimmed) * 1000).toISOString();
  }
  // Unix timestamp (milliseconds)
  if (/^\d{13}$/.test(trimmed)) {
    return new Date(Number(trimmed)).toISOString();
  }
  // Fallback: try Date.parse
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) return new Date(parsed).toISOString();
  // Final fallback: now
  return new Date().toISOString();
}

/** Parse extra labels from config string like "env=prod,region=us-east" */
function parseExtraLabels(extra?: string): Record<string, string> {
  if (!extra) return {};
  const labels: Record<string, string> = {};
  for (const pair of extra.split(',')) {
    const [k, v] = pair.split('=').map((s) => s.trim());
    if (k) labels[k] = v ?? '';
  }
  return labels;
}

/** Generate a deterministic fingerprint from service + message */
export function generateFingerprint(service: string, message: string): string {
  const raw = `${service}:${message}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((char * 31 + hash) >>> 0);
  }
  return `csv-${hash.toString(16).padStart(8, '0')}`;
}