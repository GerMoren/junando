import {
  AlertmanagerPayloadSchema,
  AlertType,
  Component,
  HTTP_TIMEOUT_MS,
  Outcome,
  ROLLBACK_ACTION_ID,
  WideEventBuilder,
  createLogger,
  createRollbackActionHandler,
  reinitLogger,
  loadConfig,
  metrics,
  normalizePayload,
  SQSAlertQueue,
  flushLoki,
} from '@junando/core';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import type {
  Config,
  IRollbackActionHandler,
  RollbackActionRequest,
  RollbackActionResult,
} from '@junando/core';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const logger = createLogger();

function sleep(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Rollback handler timed out after ${ms}ms`)), ms);
  });
}

/**
 * Zod schema for Slack interactivity payload validation.
 * Covers button clicks, modal submissions, and option selections.
 */
const SlackInteractivityPayloadSchema = z.object({
  type: z.string(),
  user: z
    .object({
      username: z.string().optional(),
      id: z.string().optional(),
    })
    .optional(),
  actions: z
    .array(
      z.object({
        action_id: z.string().optional(),
        value: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  container: z
    .object({
      message_ts: z.string().optional(),
    })
    .optional(),
  message: z
    .object({
      ts: z.string().optional(),
    })
    .optional(),
  response_url: z.string().url().optional(),
  channel: z
    .object({
      id: z.string().optional(),
    })
    .optional(),
});

/**
 * Verifies Slack request signature using HMAC-SHA256 with timing-safe comparison.
 * Rejects requests older than 5 minutes to prevent replay attacks.
 */
function verifySlackSignature(
  signature: string | undefined,
  timestamp: string | undefined,
  body: string,
  signingSecret: string,
): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  // Reject requests older than 5 minutes to prevent replay attacks
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = Number.parseInt(timestamp, 10);
  if (Number.isNaN(requestTime) || Math.abs(currentTime - requestTime) > 300) {
    return false;
  }

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = createHmac('sha256', signingSecret);
  hmac.update(baseString, 'utf8');
  const computedSignature = `v0=${hmac.digest('hex')}`;

  // Use timingSafeEqual to prevent timing attacks
  const sigBuffer = Buffer.from(signature, 'utf8');
  const computedBuffer = Buffer.from(computedSignature, 'utf8');

  if (sigBuffer.length !== computedBuffer.length) {
    return false;
  }

  return timingSafeEqual(sigBuffer, computedBuffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Slack rollback action helpers
// ─────────────────────────────────────────────────────────────────────────────

const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

/**
 * Zod schema for the JSON value encoded in the Slack rollback button.
 * Validates alertType against the AlertType enum and urgencyLevel against
 * the allowed union so malformed or tampered values are rejected.
 */
const RollbackButtonValueSchema = z.object({
  fingerprint: z.string().min(1),
  serviceName: z.string().min(1),
  endpointPath: z.string().min(1),
  alertType: z.nativeEnum(AlertType),
  urgencyLevel: z.enum(URGENCY_LEVELS),
});

/**
 * Parses and validates the JSON value encoded in the Slack rollback button.
 * Returns null on any failure so the caller can ignore the action safely.
 */
function parseRollbackValue(value: string | undefined): {
  fingerprint: string;
  serviceName: string;
  endpointPath: string;
  alertType: AlertType;
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
} | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return RollbackButtonValueSchema.parse(parsed);
  } catch (err) {
    logger.warn({ err, value }, 'Invalid rollback button value');
    return null;
  }
}

function buildRollbackActionRequest(
  parsed: ReturnType<typeof parseRollbackValue>,
  payload: z.infer<typeof SlackInteractivityPayloadSchema>,
  correlationId: string,
): RollbackActionRequest {
  // Defensive: parseRollbackValue already validated non-null, but TS needs the guard.
  if (!parsed) {
    throw new Error('Invalid rollback action value');
  }

  return {
    fingerprint: parsed.fingerprint,
    serviceName: parsed.serviceName,
    endpointPath: parsed.endpointPath,
    alertType: parsed.alertType as RollbackActionRequest['alertType'],
    urgencyLevel: parsed.urgencyLevel as NonNullable<RollbackActionRequest['urgencyLevel']>,
    triggeredBy: {
      ...(payload.user?.id !== undefined && { id: payload.user.id }),
      ...(payload.user?.username !== undefined && { username: payload.user.username }),
      channel: 'slack',
    },
    correlationId,
    ...(payload.container?.message_ts !== undefined && {
      messageTs: payload.container.message_ts,
    }),
  };
}

async function sendSlackEphemeral(responseUrl: string | undefined, text: string): Promise<void> {
  if (!responseUrl) {
    logger.warn('No Slack response_url available; skipping rollback result message');
    return;
  }

  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        response_type: 'ephemeral',
        replace_original: false,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS.SlackResponseUrl),
    });
  } catch (err) {
    logger.warn({ err, responseUrl }, 'Failed to send Slack rollback response');
  }
}

function isRollbackAuthorized(
  payload: z.infer<typeof SlackInteractivityPayloadSchema>,
  config: Config,
): { authorized: true } | { authorized: false; reason: string } {
  if (config.notifierType !== 'slack') {
    return { authorized: false, reason: 'Rollback actions are only available with Slack notifier' };
  }
  if (config.rollbackActionEnabled === false) {
    return { authorized: false, reason: 'Rollback actions are disabled' };
  }
  const allowed = config.rollbackActionAllowedSlackUserIds;
  if (allowed && allowed.length > 0 && !allowed.includes(payload.user?.id ?? '')) {
    return { authorized: false, reason: 'You are not authorized to trigger rollback actions' };
  }
  return { authorized: true };
}

async function handleRollbackAction(
  action: {
    action_id?: string | undefined;
    value?: string | undefined;
    type?: string | undefined;
  },
  payload: z.infer<typeof SlackInteractivityPayloadSchema>,
  correlationId: string,
  config: Config,
): Promise<void> {
  const auth = isRollbackAuthorized(payload, config);
  if (!auth.authorized) {
    logger.warn(
      { user: payload.user, correlationId, reason: auth.reason },
      'Unauthorized rollback attempt',
    );
    await sendSlackEphemeral(payload.response_url, `❌ ${auth.reason}`);
    return;
  }

  const handler: IRollbackActionHandler = createRollbackActionHandler(config);
  const parsedValue = parseRollbackValue(action.value);

  if (!parsedValue) {
    logger.warn({ action, correlationId }, 'Invalid rollback action value');
    await sendSlackEphemeral(payload.response_url, '❌ Invalid rollback action value');
    return;
  }

  const request = buildRollbackActionRequest(parsedValue, payload, correlationId);
  const startMs = Date.now();
  let result: RollbackActionResult;
  let rollbackOutcome: 'ok' | 'error' = 'ok';

  try {
    result = await Promise.race([
      handler.handle(request),
      sleep(HTTP_TIMEOUT_MS.RollbackHandler),
    ]);
  } catch (err) {
    rollbackOutcome = 'error';
    result = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const wideEvent = new WideEventBuilder(correlationId, Component.Rollback)
    .set('outcome', result.ok ? Outcome.Success : Outcome.Error)
    .set('rollback', {
      actionId: ROLLBACK_ACTION_ID,
      channel: 'slack',
      outcome: rollbackOutcome,
      handlerMessage: result.message,
    })
    .set('durationMs', Date.now() - startMs)
    .flush();

  logger.info(wideEvent);

  // Best-effort Slack feedback; failures here must not affect the HTTP response.
  const text = result.ok
    ? `✅ Rollback action completed: ${result.message}`
    : `❌ Rollback action failed: ${result.message}`;
  await sendSlackEphemeral(payload.response_url, text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lambda A — Webhook Receiver
// Receives Alertmanager webhook → validates → publishes to SQS → 200 in <50ms
// No business logic here. Just boundary validation and enqueue.
// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    return await _handler(event);
  } finally {
    await flushLoki();
  }
};

async function _handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const QUEUE_URL = process.env['SQS_QUEUE_URL'] ?? '';
  const start = Date.now();

  // Accept the upstream correlationId (Alertmanager x-correlation-id header) so
  // the whole pipeline can be traced end-to-end. Spec requires UUID v4 everywhere,
  // so an absent or malformed header falls back to a freshly generated UUID.
  const correlationIdHeader = event.headers?.['x-correlation-id'];
  const correlationId =
    correlationIdHeader && z.string().uuid().safeParse(correlationIdHeader).success
      ? correlationIdHeader
      : randomUUID();

  // Health check
  if (event.rawPath === '/health') {
    metrics.webhookRequestsTotal.inc({ endpoint: '/health', status: '200' });
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ok', service: 'junando-webhook' }),
    };
  }

  // Metrics endpoint
  if (event.rawPath === '/metrics') {
    metrics.webhookRequestsTotal.inc({ endpoint: '/metrics', status: '200' });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: await metrics.registry.metrics(),
    };
  }

  // Slack Interactivity endpoint
  if (event.rawPath === '/webhook/slack-interactivity') {
    if (!event.body) {
      metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/slack-interactivity', status: '400' });
      return { statusCode: 400, body: 'Missing body' };
    }

    // Slack sends URL-encoded payload: payload=%7B%22type%22%3A%22...%22%7D
    // Lambda Function URL may base64-encode binary/form bodies
    // IMPORTANT: HMAC must be verified against the raw body as Slack sent it
    // When base64 encoded, decode to get the original URL-encoded string
    const bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;

    const urlParams = new URLSearchParams(bodyStr);
    const payloadStr = urlParams.get('payload');

    if (!payloadStr) {
      metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/slack-interactivity', status: '400' });
      return { statusCode: 400, body: 'Missing payload parameter' };
    }

    const config = await loadConfig();
    reinitLogger(); // swap in Loki transport now that LOKI_URL is available

    if (config.notifierType !== 'slack') {
      metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/slack-interactivity', status: '400' });
      logger.warn({ correlationId, notifierType: config.notifierType }, 'Slack interactivity requires Slack notifier');
      return { statusCode: 400, body: 'Slack interactivity requires Slack notifier' };
    }

    if (!config.slackSigningSecret) {
      metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/slack-interactivity', status: '400' });
      logger.warn({ correlationId }, 'Slack signing secret not configured');
      return { statusCode: 400, body: 'Slack signing secret not configured' };
    }

    const slackSignature = event.headers['x-slack-signature'];
    const slackTimestamp = event.headers['x-slack-request-timestamp'];

    if (!verifySlackSignature(slackSignature, slackTimestamp, bodyStr, config.slackSigningSecret)) {
      metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/slack-interactivity', status: '401' });
      logger.warn({ correlationId }, 'Invalid Slack signature');
      return { statusCode: 401, body: 'Invalid signature' };
    }

    // Validate Slack interactivity payload with Zod schema
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(payloadStr);
    } catch {
      metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/slack-interactivity', status: '400' });
      return { statusCode: 400, body: 'Invalid JSON in payload' };
    }

    const parsedPayload = SlackInteractivityPayloadSchema.safeParse(rawPayload);
    if (!parsedPayload.success) {
      metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/slack-interactivity', status: '422' });
      return { statusCode: 422, body: 'Invalid payload schema' };
    }

    const actionPayload = parsedPayload.data;
    const action = actionPayload.actions?.[0];
    const user = actionPayload.user?.username || 'someone';

    if (action) {
      logger.info(
        { actionId: action.action_id, value: action.value, user },
        'Slack interaction received',
      );

      if (action.action_id === ROLLBACK_ACTION_ID) {
        await handleRollbackAction(action, actionPayload, correlationId, config);
      }
    }

    metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/slack-interactivity', status: '200' });
    return { statusCode: 200, body: '' };
  }

  if (!event.body) {
    metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/alert', status: '400' });
    return { statusCode: 400, body: JSON.stringify({ error: 'Empty body' }) };
  }

  // Parse and validate at the boundary
  let raw: unknown;
  try {
    raw = JSON.parse(event.body);
  } catch {
    metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/alert', status: '400' });
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const parsed = AlertmanagerPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/alert', status: '422' });
    metrics.latency.observe({ status: 'error' }, (Date.now() - start) / 1000);
    return {
      statusCode: 422,
      body: JSON.stringify({
        error: 'Invalid payload',
        issues: parsed.error.issues,
      }),
    };
  }

  // Normalizar payload
  const alerts = normalizePayload(parsed.data);
  if (alerts.length === 0) {
    metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/alert', status: '200_empty' });
    // All resolved
    return { statusCode: 200, body: JSON.stringify({ accepted: 0 }) };
  }

  metrics.alertsReceived.inc({ status: 'accepted' }, alerts.length);
  metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/alert', status: '200' });

  // Publish to SQS — this is the only AWS call in Lambda A
  if (QUEUE_URL) {
    const sqsQueue = new SQSAlertQueue(QUEUE_URL);

    // Check message size before publishing (SQS 256KB limit)
    const messageBody = { correlationId, alerts };
    const messageSize = Buffer.byteLength(JSON.stringify(messageBody), 'utf8');
    const MAX_SQS_MESSAGE_SIZE = 250_000; // 250KB limit for SQS

    let finalMessageBody = messageBody;
    if (messageSize > MAX_SQS_MESSAGE_SIZE) {
      // Truncate annotations to fit within limit
      const truncatedAlerts = alerts.map((alert) => ({
        ...alert,
        annotations: alert.annotations
          ? Object.fromEntries(
              Object.entries(alert.annotations).map(([k, v]) => [k, v.slice(0, 1000)]),
            )
          : {},
      }));
      finalMessageBody = { correlationId, alerts: truncatedAlerts };
      logger.warn(
        {
          originalSize: messageSize,
          truncatedSize: Buffer.byteLength(JSON.stringify(finalMessageBody), 'utf8'),
        },
        'Message truncated due to size limit',
      );
    }

    await sqsQueue.sendMessage({
      messageBody: JSON.stringify(finalMessageBody),
      messageGroupId: parsed.data.groupKey, // FIFO queue support
      messageDeduplicationId: correlationId,
    });
  } else {
    logger.info(
      { alerts },
      `[LOCAL DEV] Webhook received ${alerts.length} alerts. Bypassing SQS publish. Executing inline.`,
    );

    // Dynamic import to keep Lambda A cold start fast in AWS
    const {
      ProcessIncidentUseCase,
      InMemoryDeduplicationStore,
      MockTraceRepository,
      createLLMProvider,
      createNotifier,
      loadConfig,
    } = await import('@junando/core');

    try {
      const config = await loadConfig();
      reinitLogger(); // swap in Loki transport now that LOKI_URL is available
      const dedup = new InMemoryDeduplicationStore();
      const traces = new MockTraceRepository();

      const llm = createLLMProvider(config.llmProvider, config.llmApiKey, config.llmModel);
      const notifier = createNotifier(config);

      const useCase = new ProcessIncidentUseCase({
        dedup,
        traces,
        llm,
        notifier,
        logger,
        dedupTtlSeconds: config.dedupTtlSeconds,
      });

      // Fire and forget so webhook returns <50ms in local dev
      useCase.execute(alerts, correlationId).catch((err) => {
        metrics.pipelineInlineFailuresTotal.inc({ reason: 'execution_error' });
        logger.error({ err, correlationId }, 'Inline pipeline execution failed');
      });
    } catch (err) {
      metrics.pipelineInlineFailuresTotal.inc({ reason: 'init_error' });
      logger.error({ err, correlationId }, 'Failed to initialize inline pipeline');
    }
  }

  metrics.latency.observe({ status: 'success' }, (Date.now() - start) / 1000);
  return {
    statusCode: 200,
    body: JSON.stringify({ accepted: alerts.length, correlationId }),
  };
}
