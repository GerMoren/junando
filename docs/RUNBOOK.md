# Junando AIOps — Operations Runbook

Operational reference for on-call engineers. Covers reusable LogQL queries and six failure scenarios with detection, diagnosis, and remediation steps.

Related docs: [Grafana Setup](runbooks/grafana-setup.md) · [Deploy Guide](../DEPLOY.md) · [Alertmanager Config](ALERTMANAGER.md)

---

## Reusable LogQL Queries

All queries target the label `service_name=junando`. Adjust `$environment` and time range as needed.

### 1. Trace a full pipeline by correlationId

Follow a single alert from webhook ingestion through to Slack delivery:

```logql
{service_name="junando"} | json | correlationId = "<CORRELATION_ID>"
```

### 2. Find all LLM failures (errors and 429s)

Surface provider errors, rate-limit events, and fallback hops:

```logql
{service_name="junando"} | json | useCase = "llm:request" | level = "error"
```

Or filter on the HTTP status logged by the OpenRouter adapter:

```logql
{service_name="junando"} | json | msg =~ "LLM.*429|LLM.*5[0-9]{2}|fallback"
```

### 3. Find webhook 5xx errors

Isolate Lambda A handler failures that returned an error status to Alertmanager:

```logql
{service_name="junando"} | json | service = "webhook" | level = "error"
```

### 4. Find slow pipelines (latency outliers)

Identify worker invocations where end-to-end processing exceeded 10 seconds:

```logql
{service_name="junando"} | json | service = "worker" | durationMs > 10000
```

Or find individual LLM calls with high latency:

```logql
{service_name="junando"} | json | useCase =~ "llm:.*" | latencyMs > 5000
```

### 5. Trace a specific alert fingerprint end-to-end

Useful when an alert was processed but no Slack message arrived:

```logql
{service_name="junando"} | json | fingerprint = "<FINGERPRINT_SHA256>"
```

### 6. Find Slack delivery failures

Surface notifier errors and retry exhaustion events:

```logql
{service_name="junando"} | json | service = "notifier" | level = "error"
```

### 7. Find worker Lambda timeouts or hard crashes

Look for abrupt terminations (no graceful error log):

```logql
{service_name="junando"} | json | service = "worker" | msg =~ "timeout|Task timed out|SIGTERM"
```

---

## Failure Scenarios

---

### Scenario 1 — Loki Down (Logs Not Arriving)

#### Detection

- No new log entries appear in Grafana Loki for `service_name=junando` over the last 15 minutes despite known webhook traffic.
- The Loki push endpoint (configured in `LOKI_URL`) returns 5xx or is unreachable.
- The Grafana **Alert Volume** dashboard shows data gaps (panels blank or stale).

#### Diagnosis

1. Check if alerts are still being processed by inspecting CloudWatch Logs directly:
   ```bash
   aws logs tail /aws/lambda/junando-webhook --follow
   aws logs tail /aws/lambda/junando-worker --follow
   ```
2. Confirm Loki endpoint health from outside AWS:
   ```bash
   curl -I https://<USER>:<TOKEN>@logs-prod-XXX.grafana.net/loki/api/v1/labels
   ```
3. Check Grafana Cloud status page for active incidents: https://status.grafana.com
4. Verify the `LOKI_URL` SSM parameter is correct and the token has `logs:write` scope:
   ```bash
   aws ssm get-parameter --name /junando/loki-url --with-decryption
   ```
5. Look for Loki flush errors in CloudWatch Logs — the in-process transport logs push failures at `warn` level with `msg: "loki flush failed"`.

#### Remediation

- **Transient outage**: Loki push failures are silent and non-blocking — Lambda execution continues normally. No data is retried; logs during the outage window are lost. Wait for Loki to recover and confirm new logs appear.
- **Wrong credentials**: Rotate the Grafana Cloud API token, update the SSM parameter, and redeploy:
  ```bash
  aws ssm put-parameter --name /junando/loki-url \
    --value "https://NEW_USER:NEW_TOKEN@logs-prod-XXX.grafana.net/loki/api/v1/push" \
    --type SecureString --overwrite
  pnpm cdk deploy --all
  ```
- **Sustained outage**: CloudWatch Logs remain the authoritative sink. Use CloudWatch Logs Insights for queries until Loki recovers.

---

### Scenario 2 — LLM Provider Down (Sustained 5xx or 429s)

#### Detection

- Slack notifications arrive but contain no AI diagnosis (cluster summary only).
- Loki query for LLM errors returns results:
  ```logql
  {service_name="junando"} | json | useCase = "llm:request" | level = "error"
  ```
- Loki query for 429 / fallback events:
  ```logql
  {service_name="junando"} | json | msg =~ "LLM.*429|fallback|rate.limit"
  ```
- CloudWatch Logs for `junando-worker` show repeated `llm:request:error` log lines.

#### Diagnosis

1. Check the `model` field in error logs to identify which provider is failing:
   ```logql
   {service_name="junando"} | json | useCase = "llm:request" | level = "error" | line_format "model={{.model}} msg={{.msg}}"
   ```
2. Verify the fallback chain is configured — inspect the SSM parameter:
   ```bash
   aws ssm get-parameter --name /junando/llm-fallback-models --with-decryption
   ```
3. Check if all models in the fallback chain are exhausted (the final fallback also returns error).
4. Confirm API key validity by calling the provider directly with `curl`.
5. Check provider status pages:
   - OpenRouter: https://openrouter.ai (no public status page — check their Discord)
   - Gemini: https://status.cloud.google.com
   - Anthropic Claude: https://status.anthropic.com

#### Remediation

- **Primary model 429 (rate limit)**: The OpenRouter adapter retries once with backoff using `retry_after_seconds` from the response, capped at 30s. If the fallback chain is configured, it will cascade to the next model automatically. No action needed unless all models in the chain are exhausted.
- **All models exhausted**: Worker sends cluster summary to Slack without AI diagnosis. Alerts are not lost. Update the fallback chain to include a model with available quota:
  ```bash
  aws ssm put-parameter --name /junando/llm-fallback-models \
    --value "google/gemma-4-31b-it:free,mistralai/mistral-7b-instruct:free" \
    --type SecureString --overwrite
  ```
  No redeploy needed — the worker reads SSM on each cold start.
- **Expired or invalid API key**: Rotate the key and update SSM:
  ```bash
  aws ssm put-parameter --name /junando/llm-api-key \
    --value "sk-or-v2-NEW..." \
    --type SecureString --overwrite
  ```

---

### Scenario 3 — SQS DLQ Filling Up

#### Detection

- CloudWatch alarm `junando-dlq-alarm` transitions to `ALARM` state.
- The **SQS Health** Grafana dashboard shows rising DLQ depth.
- CloudWatch metric `ApproximateNumberOfMessagesVisible` on `junando-alerts-dlq` is non-zero and growing.

#### Diagnosis

1. Check current DLQ depth:
   ```bash
   aws sqs get-queue-attributes \
     --queue-url https://sqs.<region>.amazonaws.com/<account>/junando-alerts-dlq \
     --attribute-names ApproximateNumberOfMessages
   ```
2. Check worker Lambda logs for the error that caused repeated failures:
   ```bash
   aws logs tail /aws/lambda/junando-worker --follow
   ```
   Or in Loki:
   ```logql
   {service_name="junando"} | json | service = "worker" | level = "error"
   ```
3. Identify the failing `correlationId` or `fingerprint` from the error logs to determine if it is a single bad message or a systemic failure.
4. Check if the worker Lambda itself is in an error state (memory, timeout, missing env vars):
   ```bash
   aws lambda get-function-configuration --function-name junando-worker
   ```

#### Remediation

- **Systemic worker failure** (all messages failing): Fix the root cause (see Scenarios 4 and 6), then redrive messages from the DLQ:
  ```bash
  aws sqs start-message-move-task \
    --source-arn arn:aws:sqs:<region>:<account>:junando-alerts-dlq \
    --destination-arn arn:aws:sqs:<region>:<account>:junando-alerts
  ```
- **Single poison-pill message**: Purge the DLQ after logging the message body for post-mortem:
  ```bash
  # Receive and log the message body before purging
  aws sqs receive-message \
    --queue-url https://sqs.<region>.amazonaws.com/<account>/junando-alerts-dlq \
    --max-number-of-messages 1

  aws sqs purge-queue \
    --queue-url https://sqs.<region>.amazonaws.com/<account>/junando-alerts-dlq
  ```
- **Alert DLQ alarm**: Once DLQ depth returns to 0, the alarm will auto-resolve on the next evaluation period (default: 1 minute).

---

### Scenario 4 — Webhook Lambda Returning 5xx

#### Detection

- Alertmanager marks the `junando` receiver as unhealthy and begins retrying or routing to a fallback receiver.
- CloudWatch Logs for `junando-webhook` contain error-level entries.
- Loki query surfaces errors:
  ```logql
  {service_name="junando"} | json | service = "webhook" | level = "error"
  ```
- HTTP client (Alertmanager, curl test) receives `500` or `502` responses.

#### Diagnosis

1. Check live webhook Lambda logs:
   ```bash
   aws logs tail /aws/lambda/junando-webhook --follow
   ```
2. Test the endpoint manually:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     -X POST https://<lambda-url>/webhook/alert \
     -H "Content-Type: application/json" \
     -d '{"version":"4","alerts":[]}'
   ```
3. Check for Zod validation errors — the Lambda returns `400` for invalid payloads (not `500`). A `500` means an unhandled exception.
4. Check if the SQS `SendMessage` call is failing (IAM permission error, queue URL wrong):
   ```logql
   {service_name="junando"} | json | service = "webhook" | msg =~ "sqs|queue|enqueue"
   ```
5. Verify the Lambda execution role has `sqs:SendMessage` on `junando-alerts`:
   ```bash
   aws lambda get-function-configuration --function-name junando-webhook \
     --query 'Role'
   ```

#### Remediation

- **Unhandled exception in handler code**: Review the stack trace in CloudWatch Logs, fix the bug, rebuild, and redeploy:
  ```bash
  pnpm build
  cd packages/cdk && pnpm cdk deploy --all
  ```
- **SQS permission error**: Update the CDK stack IAM policy and redeploy. Do not patch Lambda env vars manually (see DEPLOY.md warning).
- **Lambda in throttled state**: Check concurrency limits:
  ```bash
  aws lambda get-function-concurrency --function-name junando-webhook
  ```
  Increase reserved concurrency or remove the limit.
- **Rollback**: To revert to the previous Lambda version:
  ```bash
  aws lambda update-alias --function-name junando-webhook \
    --name live --function-version <previous-version>
  ```

---

### Scenario 5 — Slack Delivery Failures

#### Detection

- Incidents are processed (LLM analysis completes) but no Slack message appears in the target channel.
- Loki query surfaces notifier errors:
  ```logql
  {service_name="junando"} | json | service = "notifier" | level = "error"
  ```
- Worker Lambda logs show `slack:delivery:error` with HTTP status codes.
- DLQ depth may increase if Slack errors cause the worker to throw after exhausting retries.

#### Diagnosis

1. Check notifier error details — look for HTTP status, error message, and retry count:
   ```logql
   {service_name="junando"} | json | service = "notifier" | level = "error" | line_format "msg={{.msg}} correlationId={{.correlationId}}"
   ```
2. Common Slack error codes:
   - `invalid_auth` — Bot token is wrong or revoked
   - `channel_not_found` — Channel name changed or bot not invited
   - `not_in_channel` — Bot needs to be invited to the channel
   - `ratelimited` — Slack API rate limit (transient)
3. Verify the bot token and channel in SSM:
   ```bash
   aws ssm get-parameter --name /junando/slack-bot-token --with-decryption
   aws ssm get-parameter --name /junando/slack-channel --with-decryption
   ```
4. Confirm the bot is invited to the channel in Slack (`/invite @junando`).
5. Check Slack API status: https://status.slack.com

#### Remediation

- **Invalid or revoked token**: Generate a new bot token in the Slack App settings, update SSM, and redeploy:
  ```bash
  aws ssm put-parameter --name /junando/slack-bot-token \
    --value "xoxb-NEW..." \
    --type SecureString --overwrite
  pnpm cdk deploy --all
  ```
- **Bot not in channel**: Invite the bot in Slack. No redeploy needed.
- **Wrong channel**: Update the SSM parameter and redeploy.
- **Transient rate limit**: The notifier retries 3 times with backoff. If all retries are exhausted the message is lost for that invocation; SQS retries will cause the worker to reattempt.
- **Messages in DLQ from Slack errors**: Once the Slack issue is resolved, redrive from DLQ (see Scenario 3 remediation).

---

### Scenario 6 — Worker Lambda Timing Out

#### Detection

- CloudWatch Logs for `junando-worker` contain `Task timed out after X.XX seconds`.
- SQS message visibility timeout expires and messages re-appear in the queue, eventually hitting DLQ.
- Loki query:
  ```logql
  {service_name="junando"} | json | service = "worker" | msg =~ "timeout|timed out|SIGTERM"
  ```
- DLQ depth increasing (see Scenario 3 detection).
- The **SQS Health** dashboard shows messages not being consumed.

#### Diagnosis

1. Identify the stage where the timeout occurs by checking the last log line before the timeout in CloudWatch Logs:
   ```logql
   {service_name="junando"} | json | service = "worker" | correlationId = "<ID>"
   ```
   The pipeline stages in order: dedup → cluster → trace extraction (Loki) → LLM inference → Slack notification.
2. Check current Lambda timeout setting:
   ```bash
   aws lambda get-function-configuration --function-name junando-worker \
     --query 'Timeout'
   ```
   Default is 180 seconds (3 minutes).
3. Check for high `durationMs` or `latencyMs` in recent successful invocations to identify which stage is slow:
   ```logql
   {service_name="junando"} | json | service = "worker" | durationMs > 0 | line_format "durationMs={{.durationMs}} useCase={{.useCase}}"
   ```
4. Check if Loki trace extraction is hanging (unreachable Loki endpoint adds latency before graceful fallback):
   ```logql
   {service_name="junando"} | json | useCase = "trace:fetch" | latencyMs > 5000
   ```
5. Check if LLM calls are consuming most of the budget:
   ```logql
   {service_name="junando"} | json | useCase =~ "llm:.*" | latencyMs > 30000
   ```

#### Remediation

- **Increase Lambda timeout**: Update the CDK stack (maximum is 15 minutes for Lambda):
  Edit `packages/cdk/lib/junando-stack.ts`, increase the `timeout` value, then redeploy:
  ```bash
  pnpm build
  cd packages/cdk && pnpm cdk deploy --all
  ```
- **LLM causing timeouts**: Reduce `llm-fallback-timeout-ms` in SSM to cap the fallback chain wall-clock budget (default: 60000 ms). If the primary model is slow, switch to a faster model:
  ```bash
  aws ssm put-parameter --name /junando/llm-fallback-timeout-ms \
    --value "30000" \
    --type SecureString --overwrite
  ```
- **Loki trace fetch hanging**: Loki calls are designed to fail gracefully. If they are blocking longer than expected, verify the Loki endpoint is responsive (see Scenario 1). The worker will continue without traces once the Loki client times out.
- **Cluster too large**: If a single SQS message contains an unusually large alert cluster, it may exceed the Lambda budget. Review the clustering window (`CLUSTER_WINDOW_MS`) and consider reducing it to shrink cluster size.
- **Redrive DLQ after fixing the root cause** (see Scenario 3 remediation).
