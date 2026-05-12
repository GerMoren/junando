import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { type Construct } from 'constructs';
import * as path from 'node:path';

// CDK is run from packages/cdk, so paths are relative to there
const assetPath = (pkg: string) => path.join(process.cwd(), '..', pkg, 'dist');

// ─────────────────────────────────────────────────────────────────────────────
// JunandoStack — all infrastructure defined in TypeScript. Zero YAML.
// ─────────────────────────────────────────────────────────────────────────────

export class JunandoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Lambda Layer for shared packages (@junando/core) ─────────────────────
    const coreLayer = new lambda.LayerVersion(this, 'JunandoCoreLayer', {
      code: lambda.Code.fromAsset(path.join(process.cwd(), '..', 'core', 'dist')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      layerVersionName: 'junando-core-layer',
    });

    // ── Dead Letter Queue ────────────────────────────────────────────────────
    const dlq = new sqs.Queue(this, 'AlertDLQ', {
      queueName: 'junando-alerts-dlq.fifo',
      retentionPeriod: cdk.Duration.days(14),
      fifo: true,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
    });

    // ── Main Queue ───────────────────────────────────────────────────────────
    const queue = new sqs.Queue(this, 'AlertQueue', {
      queueName: 'junando-alerts.fifo',
      visibilityTimeout: cdk.Duration.minutes(3), // must match Lambda B timeout
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
      fifo: true,
      contentBasedDeduplication: true,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
    });

    // ── Lambda A — Webhook Receiver ──────────────────────────────────────────
    const webhookFn = new lambda.Function(this, 'WebhookLambda', {
      functionName: 'junando-webhook',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(assetPath('webhook')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(5),
      layers: [coreLayer],
      environment: {
        SQS_QUEUE_URL: queue.queueUrl,
        NODE_ENV: 'production',
        SSM_PREFIX: '/junando',
      },
    });
    queue.grantSendMessages(webhookFn);

    // Grant SSM read access to Webhook (needed for Slack signing secret)
    webhookFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['ssm:GetParameter*', 'ssm:DescribeParameters', 'kms:Decrypt'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/junando/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/junando`,
        ],
      }),
    );

    // Lambda Function URL — no API Gateway needed
    const fnUrl = webhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // ── Lambda B — SQS Worker ────────────────────────────────────────────────
    const workerFn = new lambda.Function(this, 'WorkerLambda', {
      functionName: 'junando-worker',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(assetPath('worker')),
      memorySize: 512,
      timeout: cdk.Duration.minutes(3),
      layers: [coreLayer],
      environment: {
        NODE_ENV: 'production',
        SSM_PREFIX: '/junando',
      },
    });

    // Grant SSM read access (robust pattern)
    workerFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['ssm:GetParameter*', 'ssm:DescribeParameters', 'kms:Decrypt'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/junando/*`,
          // Some SDK calls might need access to the root or alias
          `arn:aws:ssm:${this.region}:${this.account}:parameter/junando`,
        ],
      }),
    );

    // Wire SQS → Lambda B
    workerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(queue, {
        batchSize: 1, // one alert batch per invocation in MVP
        reportBatchItemFailures: true,
      }),
    );
    queue.grantConsumeMessages(workerFn);

    // ── CloudWatch Alarms ────────────────────────────────────────────────────
    new cloudwatch.Alarm(this, 'DLQAlarm', {
      metric: dlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Junando: messages in DLQ — pipeline failing',
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'WebhookURL', {
      value: fnUrl.url,
      description: 'Paste this URL in Alertmanager webhook_configs',
    });

    new cdk.CfnOutput(this, 'QueueURL', {
      value: queue.queueUrl,
      description: 'SQS queue URL',
    });
  }
}
