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

Create 8 SecureString parameters in AWS Systems Manager Parameter Store:

| Parameter                       | Description                                               | Example Value                                                   |
| ------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| `/junando/llm-provider`         | AI provider                                               | `openrouter`, `claude`, `gemini`, `qwen`                        |
| `/junando/llm-api-key`          | API key for LLM                                           | `sk-or-...`                                                     |
| `/junando/llm-model`            | Model override (optional but recommended)                 | `google/gemma-4-31b-it:free`                                    |
| `/junando/slack-bot-token`      | Slack bot token                                           | `xoxb-...`                                                      |
| `/junando/slack-signing-secret` | Slack signing secret                                      | `your_signing_secret`                                           |
| `/junando/slack-channel`        | Target Slack channel                                      | `#incidents`                                                    |
| `/junando/loki-url`             | Grafana Cloud Loki push URL **with embedded credentials** | `https://USER:TOKEN@logs-prod-XXX.grafana.net/loki/api/v1/push` |
| `/junando/redis-url`            | Redis URL for dedup                                       | `redis://your-redis:6379`                                       |

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
```

> **Note**: The worker Lambda has permission to read only `/junando/*` parameters.

### Required Lambda environment variables

CDK injects these automatically. Both are **required** — without them the Lambda will not load secrets and will fail validation at startup:

| Variable     | Value        | Why                                                    |
| ------------ | ------------ | ------------------------------------------------------ |
| `SSM_PREFIX` | `/junando`   | Tells `loadConfig()` to fetch secrets from SSM         |
| `NODE_ENV`   | `production` | Switches logger and config defaults to production mode |

### Deployment Config Inputs

These values are resolved by `bin/app.ts` with the following precedence: **shell environment variable → CDK context (`cdk.json`) → hardcoded default**.

| Input variable | Shell env var  | CDK context key | Default       | Example override                          |
| -------------- | -------------- | --------------- | ------------- | ----------------------------------------- |
| `nodeEnv`      | `NODE_ENV`     | `nodeEnv`       | `production`  | `NODE_ENV=staging pnpm cdk deploy --all`  |
| `ssmPrefix`    | `SSM_PREFIX`   | `ssmPrefix`     | `/junando`    | `SSM_PREFIX=/junando-staging pnpm cdk deploy --all` |

To deploy to a staging environment:

```bash
NODE_ENV=staging SSM_PREFIX=/junando-staging pnpm cdk deploy --all
```

The default values (`production` / `/junando`) are also declared in `packages/cdk/cdk.json` under the `context` block so that `cdk synth` is fully reproducible without any shell overrides.

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

### 4. Verify Deployment

Check CDK outputs:

```bash
cd packages/cdk
pnpm cdk outputs
```

Or check in AWS Console:

- **Lambda**: Check `junando-webhook` and `junando-worker` are active
- **SQS**: Verify `junando-alerts` and `junando-alerts-dlq` exist
- **CloudWatch**: Check DLQ alarm is created

### 5. Configure Alertmanager

Copy the `WebhookURL` from CDK outputs and add to your Alertmanager config:

```yaml
receivers:
  - name: junando
    webhook_configs:
      - url: 'https://<id>.lambda-url.<region>.on.aws'
```

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

Destroy all resources:

```bash
cd packages/cdk
pnpm cdk destroy --all
```

> **Warning**: This deletes the SQS queues, Lambda functions, and CloudWatch alarm. SSM parameters are NOT deleted (manual cleanup if needed).

---

## Troubleshooting

### "Parameter not found" error

- Verify all 7 SSM parameters exist:
  ```bash
  aws ssm get-parameter --name /junando/llm-provider
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
