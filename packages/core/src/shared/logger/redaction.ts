// ─────────────────────────────────────────────────────────────────────────────
// PII redaction — whitelist strategy: only schema-known fields survive.
// Anything outside the WideEvent schema is replaced with [REDACTED]; a
// blacklist would leak the moment a new sensitive field name appears.
// ─────────────────────────────────────────────────────────────────────────────

/** Replacement value for any field outside the whitelist. */
export const REDACTED = '[REDACTED]';

/** Whitelisted strings longer than this are cut and suffixed. */
export const MAX_STRING_CHARS = 1000;

/** Suffix appended to truncated strings so truncation is visible in queries. */
export const TRUNCATION_SUFFIX = '...[truncated]';

const ERROR_KEY = 'error';
const MESSAGE_KEY = 'message';
const NAME_KEY = 'name';
const STACK_KEY = 'stack';
const DEVELOPMENT = 'development';
const OUTCOME_KEY = 'outcome';

/**
 * Top-level fields allowed to pass through. `cluster`, `dedup`, `rule`,
 * `llm` and `notify` are schema-known subtrees whose nested values are safe.
 */
const SAFE_FIELDS: ReadonlySet<string> = new Set([
  'requestId',
  'correlationId',
  'timestamp',
  'component',
  'version',
  OUTCOME_KEY,
  'cluster',
  'dedup',
  'rule',
  'llm',
  'notify',
  'durationMs',
  ERROR_KEY,
]);

function truncateString(value: string): string {
  return value.length > MAX_STRING_CHARS
    ? value.slice(0, MAX_STRING_CHARS) + TRUNCATION_SUFFIX
    : value;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return truncateString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item)]),
    );
  }
  return value;
}

/**
 * The error section keeps only message and name; the stack is kept solely in
 * development, where it cannot reach production log stores.
 */
function redactError(error: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (typeof error[MESSAGE_KEY] === 'string') {
    safe[MESSAGE_KEY] = truncateString(error[MESSAGE_KEY]);
  }
  if (typeof error[NAME_KEY] === 'string') {
    safe[NAME_KEY] = truncateString(error[NAME_KEY]);
  }
  if (process.env['NODE_ENV'] === DEVELOPMENT && typeof error[STACK_KEY] === 'string') {
    safe[STACK_KEY] = truncateString(error[STACK_KEY]);
  }
  return safe;
}

/**
 * Deep-redacts an object against the wide-event whitelist.
 *
 * Returns a new object — the input is never mutated. Whitelisted values keep
 * their structure with over-long strings truncated; everything else becomes
 * [REDACTED].
 */
export function redact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      if (!SAFE_FIELDS.has(key)) {
        return [key, REDACTED];
      }
      if (key === ERROR_KEY && value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return [key, redactError(value as Record<string, unknown>)];
      }
      return [key, redactValue(value)];
    }),
  );
}
