# Junando AWS Deployment Guide

Complete deployment checklist for running Junando on AWS using AWS CDK.

## Prerequisites

### AWS CLI

```bash
# Verify AWS CLI is configured
aws sts get-caller-identity

# If not configured:
aws configure
```

### AWS CDK Bootstrap

Bootstrap CDK in your target account/region (one-time per account/region):

```bash
cd packages/cdk
pnpm install
pnpm cdk bootstrap
```

### Required IAM Permissions

Your AWS credentials need these permissions:

| Permission                  | Reason                            |
| --------------------------- | --------------------------------- |
| `cloudformation:*`          | CDK creates stacks                |
| `sqs:*`                     | SQS queues for alert processing   |
| `lambda:*`                  | Lambdas for webhook + worker      |
| `ssm:GetParameter`          | Read secrets from Parameter Store |
| `kms:Decrypt`               | Decrypt SecureString parameters   |
| `iam:*`                     | Lambda execution roles            |
| `logs:*`                    | CloudWatch Logs                   |
| `cloudwatch:PutMetricAlarm` | DLQ alarm                         |

> **Tip**: Use `AdministratorAccess` for initial setup, then scope down for production.

---

## Step-by-Step Deployment

### 1. Configure SSM Parameter Store Secrets

Create these 10 SecureString parameters in AWS Systems Manager Parameter Store. The names below use the production prefix; use a pilot-only prefix such as `/junando-pilot/...` for the pilot.

| Parameter                           | Description                                               | Example Value                                                   |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| `/junando/llm-provider`             | AI provider                                               | `openrouter`, `claude`, `gemini`, `qwen`                        |
| `/junando/llm-api-key`              | API key for LLM                                           | `sk-or-...`                                                     |
| `/junando/llm-model`                | Model override (optional but recommended)                 | `google/gemma-4-31b-it:free`                                    |
| `/junando/slack-bot-token`          | Slack bot token                                           | `xoxb-...`                                                      |
| `/junando/slack-signing-secret`     | Slack signing secret                                      | `your_signing_secret`                                           |
| `/junando/slack-channel`            | Target Slack channel                                      | `#incidents`                                                    |
| `/junando/loki-url`                 | Grafana Cloud Loki push URL **with embedded credentials** | `https://USER:TOKEN@logs-prod-XXX.grafana.net/loki/api/v1/push` |
| `/junando/redis-url`                | Redis URL for dedup                                       | `redis://your-redis:6379`                                       |
| `/junando/llm-fallback-models`      | Comma-separated fallback model list (optional)            | `google/gemma-4-31b-it:free,mistralai/mistral-7b-instruct:free` |
| `/junando/llm-fallback-timeout-ms`  | Wall-clock timeout ms for entire fallback chain (optional) | `60000`                                                        |

> **Loki URL gotcha**: Use the **full push path** (`/loki/api/v1/push`) and embed credentials inline (`https://USER:TOKEN@host/...`). The Grafana Cloud token must have the `logs:write` scope. New tokens can take **up to 15 minutes** to propagate — if logs don't appear, wait before debugging.

**Commands to set each parameter:**

```bash
aws ssm put-parameter \
  --name /junando/llm-provider \
  --value "openrouter" \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name /junando/llm-api-key \
  --value "sk-or-v2-..." \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name /junando/llm-model \
  --value "google/gemma-4-31b-it:free" \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name /junando/slack-bot-token \
  --value "xoxb-..." \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name /junando/slack-signing-secret \
  --value "your_signing_secret" \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name /junando/slack-channel \
  --value "#incidents" \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name /junando/loki-url \
  --value "https://USER:TOKEN@logs-prod-XXX.grafana.net/loki/api/v1/push" \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name /junando/redis-url \
  --value "redis://redis.example.com:6379" \
  --type SecureString \
  --overwrite

# Optional: LLM fallback chain (OpenRouter only)
aws ssm put-parameter \
  --name /junando/llm-fallback-models \
  --value "google/gemma-4-31b-it:free,mistralai/mistral-7b-instruct:free" \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name /junando/llm-fallback-timeout-ms \
  --value "60000" \
  --type SecureString \
  --overwrite
```

> **Note**: The worker Lambda has permission to read only `/junando/*` parameters.

For the pilot, the Lambda roles must be able to read the equivalent `SSM_PREFIX` namespace (for example, `/junando-pilot/*`). Confirm this in the synthesized/deployed IAM policy before the pilot.

### Required Lambda environment variables

CDK injects these automatically. Both are **required** — without them the Lambda will not load secrets and will fail validation at startup:

| Variable     | Value        | Why                                                    |
| ------------ | ------------ | ------------------------------------------------------ |
| `SSM_PREFIX` | `/junando`   | Tells `loadConfig()` to fetch secrets from SSM         |
| `NODE_ENV`   | `production` | Switches logger and config defaults to production mode |

For the external pilot, keep staging isolated from production:

```bash
export NODE_ENV=staging
export AWS_ENV=pilot
export SSM_PREFIX=/junando-pilot
```

Create the same 10 parameters under `/junando-pilot` before deploying. Do not reuse production secrets, Redis, Loki, queues, notification channels, or Alertmanager receivers. `AWS_ENV=pilot` gives the Lambda functions, SQS queues/DLQ, and shared layer the `junando-pilot-` physical name prefix; CloudFormation construct IDs remain unchanged.

> **Runtime validation**: The configuration schema accepts `development`, `test`, `staging`, and `production` for `NODE_ENV`. Keep `NODE_ENV=staging` for the pilot; do not silently use `production`.

### Deployment Config Inputs

These values are resolved by `bin/app.ts` with the following precedence: **shell environment variable → CDK context (`cdk.json`) → hardcoded default**.

| Input variable | Shell env var  | CDK context key | Default       | Example override                          |
| -------------- | -------------- | --------------- | ------------- | ----------------------------------------- |
| `nodeEnv`      | `NODE_ENV`     | `nodeEnv`       | `production`  | `NODE_ENV=staging pnpm cdk deploy --all`  |
| `ssmPrefix`    | `SSM_PREFIX`   | `ssmPrefix`     | `/junando`    | `AWS_ENV=pilot` defaults to `/junando-pilot`; `SSM_PREFIX=/custom` overrides it |
| `resource names` | `AWS_ENV`    | n/a           | `junando-*`   | `AWS_ENV=pilot` uses `junando-pilot-*` |

To deploy to a staging environment:

```bash
AWS_ENV=pilot NODE_ENV=staging SSM_PREFIX=/junando-pilot pnpm cdk deploy --all
```

The production defaults (`production` / `/junando`) are also declared in `packages/cdk/cdk.json` under the `context` block. When `AWS_ENV=pilot`, the deployment resolver replaces those context defaults with `staging` / `/junando-pilot`; explicit `NODE_ENV` and `SSM_PREFIX` values still take precedence.

> ⚠️ **NEVER** use `aws lambda update-function-configuration --environment "Variables={...}"` to change env vars. The AWS CLI **OVERWRITES** all existing env vars instead of merging — you will silently delete `SSM_PREFIX` / `NODE_ENV` and the Lambda will start failing on the next cold start. **Always redeploy via CDK** (`pnpm cdk deploy --all`) to change env vars.

### 2. Build All Packages

```bash
pnpm install
pnpm build
```

### 3. Deploy with CDK

```bash
cd packages/cdk
pnpm cdk deploy --all
```

Expected output:

```
 ✅  JunandoStack

Outputs:
JunandoStack.WebhookURL = https://<id>.lambda-url.<region>.on.aws
JunandoStack.QueueURL = https://sqs.<region>.amazonaws.com/<account>/junando-alerts
```

For the staging pilot, run the deploy with the explicit environment values:

```bash
AWS_ENV=pilot NODE_ENV=staging SSM_PREFIX=/junando-pilot pnpm cdk deploy --all
```

Record the resulting `WebhookURL`, `QueueURL`, and AWS region in the pilot handoff. Do not paste secrets into issue comments, terminal transcripts, or feedback forms.

### 4. Verify Deployment

Check CDK outputs:

```bash
cd packages/cdk
pnpm cdk outputs
```

Or check in AWS Console:

- **Lambda**: Check `junando-pilot-webhook` and `junando-pilot-worker` are active
- **SQS**: Verify `junando-pilot-alerts` and `junando-pilot-alerts-dlq` exist
- **CloudWatch**: Check DLQ alarm is created

### 5. Configure Alertmanager

Copy the `WebhookURL` from CDK outputs and use the ready-to-copy receiver config in [`docs/alertmanager-example.yml`](docs/alertmanager-example.yml):

```yaml
receivers:
  - name: junando
    webhook_configs:
      - url: 'https://<id>.lambda-url.<region>.on.aws'  # JunandoStack.WebhookURL
        send_resolved: false   # Junando accepts resolved payloads (HTTP 200 / {"accepted":0}) but does not forward them to Slack at MVP
        max_alerts: 0          # Junando truncates annotations if the total payload exceeds 250 KB
```

> **Resolved alerts**: Setting `send_resolved: false` is recommended to suppress unnecessary webhook calls. See [`docs/ALERTMANAGER.md`](docs/ALERTMANAGER.md) for the full edge-case reference (resolved behavior, grouping, large payloads, 30s SLA).

### 6. Test End-to-End

Generate a test alert:

```bash
pnpm run generate:alert
```

Monitor in CloudWatch:

```bash
# Watch webhook Lambda logs
aws logs tail /aws/lambda/junando-webhook --follow

# Watch worker Lambda logs
aws logs tail /aws/lambda/junando-worker --follow

# Check queue depth
aws sqs get-queue-attributes \
  --queue-url https://sqs.<region>.amazonaws.com/<account>/junando-alerts \
  --attribute-names ApproximateNumberOfMessages
```

## External Pilot Acceptance Path

Run this path with a synthetic, non-production alert before connecting a real service:

```text
Alertmanager -> public webhook Function URL -> SQS queue -> worker Lambda
             -> deduplication/clustering -> Loki enrichment -> LLM
             -> Slack or Teams notification
```

### Readiness checklist

- [ ] Pilot owner, AWS account, region, staging namespace, and on-call contact are recorded.
- [ ] AWS CLI identity and CDK bootstrap are verified in the pilot account.
- [ ] Node.js 24+, pnpm, Docker (for local preparation), and repository access are available.
- [ ] The 10 required SSM parameters exist under the pilot `SSM_PREFIX` and are `SecureString` values.
- [ ] LLM provider, model/quota, and API key are approved for staging use.
- [ ] Redis is reachable from Lambda for deduplication.
- [ ] Loki is reachable and its token has the required `logs:write` scope, or the pilot accepts reduced trace context.
- [ ] Slack bot is installed and invited to the target channel, or Teams Power Automate webhook is ready with an `api-version=` query parameter.
- [ ] Alertmanager can reach the public `WebhookURL` over HTTPS.
- [ ] The staging IAM role can read and decrypt the full staging SSM namespace.
- [ ] The pilot uses `AWS_ENV=pilot`, `NODE_ENV=staging`, and `SSM_PREFIX=/junando-pilot` consistently for deploy, verification, and teardown.

### Acceptance procedure

1. Deploy with `AWS_ENV=pilot NODE_ENV=staging SSM_PREFIX=/junando-pilot`, then record the CDK outputs.
2. Configure Alertmanager with `docs/alertmanager-example.yml`, replacing the receiver URL with the staging `WebhookURL`; set `send_resolved: false`.
3. Trigger one synthetic firing alert through Alertmanager. A direct webhook smoke test may validate the endpoint, but it does not replace this Alertmanager test.
4. Confirm the webhook returns HTTP 200 and logs an accepted alert with a `correlationId`.
5. Confirm SQS receives and the worker consumes one message; queue depth returns to zero and the DLQ remains empty.
6. Confirm worker logs show clustering/deduplication, LLM request/result, and notifier delivery for the same `correlationId`.
7. Confirm exactly one structured Slack message or Teams Adaptive Card arrives in the staging destination with service, urgency, probable cause, and recommended steps. If the LLM is unavailable, the expected fallback is a notification without AI diagnosis.
8. Capture the alert shape, `correlationId`, timestamps, notification channel, and relevant log links in the feedback template below. Never capture secret values.

### Expected evidence and logs

| Stage | Expected evidence |
| --- | --- |
| Alertmanager | Receiver delivery succeeds; no retry loop; alert is firing rather than resolved. |
| Webhook | HTTP 200, accepted count, `correlationId`, and enqueue success in `/aws/lambda/junando-webhook`. |
| Queue | Message appears briefly in the main queue; `ApproximateNumberOfMessagesNotVisible` rises during processing; DLQ remains at zero. |
| Worker | Same `correlationId` across worker, dedup/cluster, trace, LLM, and notifier events in `/aws/lambda/junando-worker`. |
| LLM | Provider/model, latency, and success or fallback outcome are present without logging the API key or prompt secrets. |
| Slack/Teams | One notification in the staging destination containing the incident summary and diagnosis or the documented no-diagnosis fallback. |

```bash
aws logs tail /aws/lambda/junando-webhook --follow
aws logs tail /aws/lambda/junando-worker --follow
aws sqs get-queue-attributes --queue-url <staging-QueueURL> \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible
```

## Security and Public Endpoint Notes

- The webhook Function URL uses `AuthType.NONE` so Alertmanager can call it. It is a public internet endpoint; anyone who discovers it can submit requests.
- Use HTTPS only, keep the endpoint restricted to the staging receiver during the pilot, and do not include credentials in the URL or Alertmanager payload.
- Treat the webhook URL as sensitive operational information. Monitor unexpected volume and DLQ growth.
- Store LLM keys, Slack tokens/signing secrets, Teams webhook URLs, Loki URLs with embedded credentials, and Redis URLs only in SSM `SecureString` parameters. Never commit them or print decrypted values in shared logs.
- Use a dedicated staging Slack channel or Teams destination. Do not give a pilot access to production notification channels.
- Rotate pilot credentials after the pilot or immediately after suspected exposure.

## Feedback and Escalation

Use a GitHub Discussion for the pilot thread (or the agreed Discord thread) and copy this template for every test:

```markdown
### Pilot feedback — YYYY-MM-DD
- Team/environment:
- Junando revision or image tag:
- AWS region and SSM prefix (prefix only, never secret values):
- Alert source and test scenario:
- Alertmanager delivery time:
- Notification channel (Slack or Teams):
- End-to-end result: pass / partial / fail
- Time to notification:
- Expected output:
- Actual output:
- Correlation ID:
- CloudWatch/Grafana links:
- Reproduction steps:
- Severity and user impact:
- Suggested improvement:
```

Escalate immediately in the pilot thread and notify the pilot owner for secret exposure, public endpoint abuse, repeated webhook 5xx responses, DLQ growth, duplicate notification storms, or missing notifications after worker processing. Include timestamps and correlation IDs, but redact payloads and credentials. Use [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for diagnosis.

---

## Verification Commands

### Check Lambda Logs

```bash
# Webhook Lambda
aws logs tail /aws/lambda/junando-webhook --follow

# Worker Lambda
aws logs tail /aws/lambda/junando-worker --follow
```

### Check SQS Queues

```bash
# Main queue
aws sqs get-queue-attributes \
  --queue-url https://sqs.<region>.amazonaws.com/<account>/junando-alerts \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible

# Dead letter queue
aws sqs get-queue-attributes \
  --queue-url https://sqs.<region>.amazonaws.com/<account>/junando-alerts-dlq \
  --attribute-names ApproximateNumberOfMessages
```

### Check CloudWatch Alarm

```bash
# Describe DLQ alarm
aws cloudwatch describe-alarms \
  --alarm-name-prefix junando
```

---

## Environment-Specific Deployment

### Production vs Development

The CDK stack uses the default environment (no explicit account/region):

```typescript
new JunandoStack(app, 'JunandoStack', { ... })
```

For environment-specific overrides, modify the stack props:

```typescript
// For production in us-east-1
new JunandoStack(app, 'JunandoStack', {
  env: {
    account: '123456789012',
    region: 'us-east-1',
  },
  nodeEnv: 'production',
  ssmPrefix: '/junando',
});
```

### Environment Variables in CDK

The stack automatically reads from SSM at deploy time. To change secrets:

1. Update the SSM parameter:

   ```bash
   aws ssm put-parameter --name /junando/llm-provider --value "claude" --type SecureString --overwrite
   ```

2. The worker Lambda will pick up the new value on its next invocation (no redeploy needed).

---

## Teardown

### Pilot rollback

To stop pilot traffic without deleting evidence:

1. Disable the `junando` receiver or remove it from the staging Alertmanager route.
2. Confirm Alertmanager is no longer delivering to the staging `WebhookURL`.
3. Record queue depth, DLQ depth, recent CloudWatch log links, and the pilot feedback entry.
4. If messages are failing, stop redriving the DLQ until the cause is understood. Do not purge the queue or DLQ before preserving the relevant correlation IDs.
5. Rotate any credential that may have been exposed and remove the pilot's notification destination access.

To remove only the pilot infrastructure, use the same `SSM_PREFIX` and AWS account/region used for deployment:

```bash
AWS_ENV=pilot NODE_ENV=staging SSM_PREFIX=/junando-pilot pnpm cdk destroy --all
```

This rollback boundary removes the staging Lambda functions, queues, and CloudWatch alarm; it does not affect production resources when the account, region, stack, and prefix are verified first.

Destroy all resources:

```bash
cd packages/cdk
pnpm cdk destroy --all
```

> **Warning**: This deletes the SQS queues, Lambda functions, and CloudWatch alarm. SSM parameters are NOT deleted (manual cleanup if needed).

---

## Troubleshooting

### "Parameter not found" error

- Verify all 10 SSM parameters exist under the active prefix:
  ```bash
  aws ssm get-parameters-by-path --path "$SSM_PREFIX" --recursive \
    --query 'Parameters[].Name'
  ```

### Lambda timeout errors

- Check worker Lambda timeout (default: 3 minutes)
- Verify Redis/Loki connectivity from Lambda

### Messages going to DLQ

- Check CloudWatch alarm: `aws cloudwatch describe-alarms --alarm-name-prefix junando`
- Review worker Lambda logs for the error

### Function URL returns 403

- The webhook uses `AuthType.NONE` (public). Ensure you're okay with this.
- For auth, modify `authType` in the CDK stack and redeploy.


---

## Observability Dashboards

Three Grafana dashboards are provided in `docs/dashboards/` for monitoring the Junando pipeline:

| Dashboard | File | Description |
|-----------|------|-------------|
| Alert Volume | `docs/dashboards/alert-volume.json` | Webhook throughput, alerts received/processed rates |
| LLM Performance | `docs/dashboards/llm-performance.json` | LLM latency p50/p99, 429 rate, fallback hops, token usage |
| SQS Health | `docs/dashboards/sqs-health.json` | SQS queue depth, DLQ depth, worker error logs |

### IAM Setup for SQS Panels

The SQS dashboard requires CloudWatch access. Add this policy to your Grafana IAM user/role:

```json
{
  "Effect": "Allow",
  "Action": ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"],
  "Resource": "*"
}
```

For the full setup guide including Loki datasource connection, cross-account IAM role, and dashboard import steps, see: **[docs/runbooks/grafana-setup.md](docs/runbooks/grafana-setup.md)**

For failure scenarios, LogQL queries, and on-call recovery procedures, see: **[docs/RUNBOOK.md](docs/RUNBOOK.md)**
