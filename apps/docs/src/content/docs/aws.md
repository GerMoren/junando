---
title: AWS Deployment
description: Deploy Junando to AWS using CDK.
---

## Prerequisites

- AWS CLI installed and configured
- AWS credentials with sufficient IAM permissions
- Node.js 24+, pnpm
- CDK bootstrapped in your target account and region

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

## Prerequisites in Detail

Before deploying, ensure:

1. **AWS CLI** is configured: `aws sts get-caller-identity`
2. **CDK is bootstrapped**: `pnpm cdk bootstrap`
3. **SSM parameters** are created under the `/junando/` prefix with all required secrets

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
