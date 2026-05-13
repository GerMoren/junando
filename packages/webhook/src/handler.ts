import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  AlertmanagerPayloadSchema,
  createLogger,
  loadConfig,
  metrics,
  normalizePayload,
} from '@junando/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const logger = createLogger();

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
// Lambda A — Webhook Receiver
// Receives Alertmanager webhook → validates → publishes to SQS → 200 in <50ms
// No business logic here. Just boundary validation and enqueue.
// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const QUEUE_URL = process.env['SQS_QUEUE_URL'] ?? '';

  const correlationId = randomUUID();

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

  // Registrar métricas
  metrics.alertsReceived.inc({ status: 'accepted' }, alerts.length);
  metrics.webhookRequestsTotal.inc({ endpoint: '/webhook/alert', status: '200' });

  // Publish to SQS — this is the only AWS call in Lambda A
  if (QUEUE_URL) {
    // Initialize SQSClient inside the handler to avoid module-level AWS credential errors in local dev.
    // TODO(tech-debt): Extract to SqsAlertQueueAdapter in @junando/core when the adapter
    // interface supports send-message with FIFO params (MessageGroupId, MessageDeduplicationId).
    const sqs = new SQSClient({});

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

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify(finalMessageBody),
        MessageGroupId: parsed.data.groupKey, // FIFO queue support
        MessageDeduplicationId: correlationId,
      }),
    );
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
      SlackNotifier,
      loadConfig,
    } = await import('@junando/core');

    try {
      const config = await loadConfig();
      const dedup = new InMemoryDeduplicationStore();
      const traces = new MockTraceRepository();

      const llm = createLLMProvider(config.llmProvider, config.llmApiKey, config.llmModel);
      const notifier = new SlackNotifier(config.slackBotToken, config.slackChannel);

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

  return {
    statusCode: 200,
    body: JSON.stringify({ accepted: alerts.length, correlationId }),
  };
};
