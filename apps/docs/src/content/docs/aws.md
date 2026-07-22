---
title: AWS Deployment
description: Deploy Junando to AWS using CDK.
---

## Prerequisites

- AWS CLI installed and configured
- AWS credentials with sufficient IAM permissions
- Node.js 24+, pnpm
- CDK bootstrapped in your target account and region
- SSM parameters created under the `/junando/` prefix with all required secrets

## Deploy

```bash
pnpm build
cd packages/cdk
pnpm cdk deploy --all
```

## Expected Output

```
 ✅  JunandoStack

Outputs:
JunandoStack.WebhookURL = https://<id>.lambda-url.<region>.on.aws
JunandoStack.QueueURL = https://sqs.<region>.amazonaws.com/<account>/junando-alerts
```

## Full Reference

For complete deployment instructions including SSM parameter setup, environment variables, IAM permissions, and Alertmanager configuration, see the canonical deployment guide:

https://github.com/GerMoren/junando/blob/main/DEPLOY.md

## Pilot Deployment

For pilot/isolated staging deployments, see the [Pilot guide](/pilot/).

## Verification

After deployment, confirm:

- Lambda functions `junando-webhook` and `junando-worker` are active
- SQS queues `junando-alerts` and `junando-alerts-dlq` exist
- The CloudWatch DLQ alarm is created

Run `pnpm cdk outputs` from `packages/cdk` to see the deployed endpoint URLs.
