import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import { type Construct } from 'constructs'
import * as path from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// JunandoStack — all infrastructure defined in TypeScript. Zero YAML.
// ─────────────────────────────────────────────────────────────────────────────

export class JunandoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ── Dead Letter Queue ────────────────────────────────────────────────────
    const dlq = new sqs.Queue(this, 'AlertDLQ', {
      queueName: 'junando-alerts-dlq',
      retentionPeriod: cdk.Duration.days(14),
    })

    // ── Main Queue ───────────────────────────────────────────────────────────
    const queue = new sqs.Queue(this, 'AlertQueue', {
      queueName: 'junando-alerts',
      visibilityTimeout: cdk.Duration.minutes(3), // must match Lambda B timeout
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    })

    // ── Read secrets from SSM (values set manually or via CI) ────────────────
    const ssmPath = (name: string) =>
      ssm.StringParameter.valueForSecureStringParameter(this, name, `/junando/${name}`)

    // ── Lambda A — Webhook Receiver ──────────────────────────────────────────
    const webhookFn = new lambda.Function(this, 'WebhookLambda', {
      functionName:   'junando-webhook',
      runtime:        lambda.Runtime.NODEJS_22_X,
      handler:        'handler.handler',
      code:           lambda.Code.fromAsset(path.join(__dirname, '../../webhook/dist')),
      memorySize:     256,
      timeout:        cdk.Duration.seconds(5),
      environment: {
        SQS_QUEUE_URL: queue.queueUrl,
        NODE_ENV:      'production',
      },
    })
    queue.grantSendMessages(webhookFn)

    // Lambda Function URL — no API Gateway needed
    const fnUrl = webhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    })

    // ── Lambda B — SQS Worker ────────────────────────────────────────────────
    const workerFn = new lambda.Function(this, 'WorkerLambda', {
      functionName: 'junando-worker',
      runtime:      lambda.Runtime.NODEJS_22_X,
      handler:      'handler.handler',
      code:         lambda.Code.fromAsset(path.join(__dirname, '../../worker/dist')),
      memorySize:   512,
      timeout:      cdk.Duration.minutes(3),
      environment: {
        LLM_PROVIDER:          ssmPath('llm-provider'),
        LLM_API_KEY:           ssmPath('llm-api-key'),
        SLACK_BOT_TOKEN:       ssmPath('slack-bot-token'),
        SLACK_SIGNING_SECRET:  ssmPath('slack-signing-secret'),
        SLACK_CHANNEL:         ssmPath('slack-channel'),
        LOKI_URL:              ssmPath('loki-url'),
        REDIS_URL:             ssmPath('redis-url'),
        NODE_ENV:              'production',
      },
    })

    // Grant SSM read access (least privilege — only /junando/* paths)
    workerFn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions:   ['ssm:GetParameter', 'kms:Decrypt'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/junando/*`],
    }))

    // Wire SQS → Lambda B
    workerFn.addEventSource(new lambdaEventSources.SqsEventSource(queue, {
      batchSize:              1, // one alert batch per invocation in MVP
      maxBatchingWindow:      cdk.Duration.seconds(10),
      reportBatchItemFailures: true,
    }))
    queue.grantConsumeMessages(workerFn)

    // ── CloudWatch Alarms ────────────────────────────────────────────────────
    new cloudwatch.Alarm(this, 'DLQAlarm', {
      metric:             dlq.metricApproximateNumberOfMessagesVisible(),
      threshold:          1,
      evaluationPeriods:  1,
      alarmDescription:   'Junando: messages in DLQ — pipeline failing',
    })

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'WebhookURL', {
      value:       fnUrl.url,
      description: 'Paste this URL in Alertmanager webhook_configs',
    })

    new cdk.CfnOutput(this, 'QueueURL', {
      value:       queue.queueUrl,
      description: 'SQS queue URL',
    })
  }
}
