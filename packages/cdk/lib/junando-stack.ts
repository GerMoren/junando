import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { type Construct } from 'constructs';
import * as path from 'node:path';
import { DEFAULT_BEDROCK_FOUNDATION_MODEL } from './resolve-deploy-config.js';

// CDK is run from packages/cdk, so paths are relative to there
const assetPath = (pkg: string) => path.join(process.cwd(), '..', pkg, 'dist');

// ─────────────────────────────────────────────────────────────────────────────
// JunandoStack — all infrastructure defined in TypeScript. Zero YAML.
// ─────────────────────────────────────────────────────────────────────────────

export interface JunandoStackProps extends cdk.StackProps {
  /** Runtime NODE_ENV for Lambda functions — resolved by bin/app.ts. */
  nodeEnv: string;
  /** SSM Parameter Store prefix for all secrets — resolved by bin/app.ts. */
  ssmPrefix: string;
  /** Prefix for physical resource names — resolved by bin/app.ts. */
  resourceNamePrefix?: string;
  /**
   * Bedrock foundation model ID, WITHOUT a region prefix (e.g. 'amazon.nova-lite-v1:0').
   * Resolved by bin/app.ts from BEDROCK_FOUNDATION_MODEL / CDK context, defaulting
   * to Nova Lite. Both the worker's BEDROCK_DEFAULT_MODEL env var and the IAM
   * grant's ARNs derive from this single value, so overriding the model can
   * never leave the two out of sync.
   */
  bedrockFoundationModel?: string;
}

const DEFAULT_RESOURCE_NAME_PREFIX = 'junando';

function resourceName(prefix: string, suffix: string): string {
  return `${prefix}-${suffix}`;
}

/** Maps a region's geo code (the segment before the first '-') to its Bedrock inference-profile prefix. */
const BEDROCK_REGION_PREFIXES: Readonly<Record<string, string>> = {
  us: 'us.',
  eu: 'eu.',
  ap: 'apac.',
};

/**
 * Resolves the Bedrock inference-profile region prefix for a deployment
 * region, or undefined when the region has no mapped prefix.
 *
 * Deliberately does NOT throw: the deployment's LLM_PROVIDER is a runtime
 * SSM value the stack cannot see at synth time, so a stack deployed to an
 * unmapped region may still be a perfectly valid non-Bedrock deployment.
 * Failing synth here would block every deployment to that region, Bedrock
 * or not — the caller only sets up Bedrock support when this resolves.
 */
function bedrockRegionPrefix(region: string): string | undefined {
  const geo = region.split('-')[0] ?? '';
  return BEDROCK_REGION_PREFIXES[geo];
}

export class JunandoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: JunandoStackProps) {
    super(scope, id, props);

    const resourceNamePrefix = props.resourceNamePrefix ?? DEFAULT_RESOURCE_NAME_PREFIX;

    // undefined when the deployment region has no mapped Bedrock prefix — see
    // bedrockRegionPrefix. Bedrock env/IAM setup below is skipped entirely in
    // that case, rather than blocking the whole stack's synth.
    const bedrockPrefix = bedrockRegionPrefix(this.region);
    const bedrockFoundationModel = props.bedrockFoundationModel ?? DEFAULT_BEDROCK_FOUNDATION_MODEL;
    const bedrockModel = bedrockPrefix ? `${bedrockPrefix}${bedrockFoundationModel}` : undefined;

    // ── Lambda Layer for shared packages (@junando/core) ─────────────────────
    const coreLayer = new lambda.LayerVersion(this, 'JunandoCoreLayer', {
      code: lambda.Code.fromAsset(path.join(process.cwd(), '..', 'core', 'dist')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
      layerVersionName: resourceName(resourceNamePrefix, 'core-layer'),
    });

    // ── Dead Letter Queue ────────────────────────────────────────────────────
    const dlq = new sqs.Queue(this, 'AlertDLQ', {
      queueName: `${resourceName(resourceNamePrefix, 'alerts-dlq')}.fifo`,
      retentionPeriod: cdk.Duration.days(14),
      fifo: true,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
    });

    // ── Main Queue ───────────────────────────────────────────────────────────
    const queue = new sqs.Queue(this, 'AlertQueue', {
      queueName: `${resourceName(resourceNamePrefix, 'alerts')}.fifo`,
      visibilityTimeout: cdk.Duration.minutes(3), // must match Lambda B timeout
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
      fifo: true,
      contentBasedDeduplication: true,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
    });

    // ── Dedup Table ──────────────────────────────────────────────────────────
    // PROVISIONED 25/25 with no autoscaling is a cost constraint, not a
    // performance one: the DynamoDB always-free allowance is provisioned-only
    // and stops at 25 RCU / 25 WCU. On-demand bills from the first request and
    // any scaling policy silently leaves the free tier. 25 WCU is ~64M
    // writes/month against a real volume of 500-10,000 alerts/month.
    const dedupTable = new dynamodb.Table(this, 'DedupTable', {
      tableName: resourceName(resourceNamePrefix, 'dedup'),
      partitionKey: { name: 'fingerprint', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 25,
      writeCapacity: 25,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Lambda A — Webhook Receiver ──────────────────────────────────────────
    const webhookFn = new lambda.Function(this, 'WebhookLambda', {
      functionName: resourceName(resourceNamePrefix, 'webhook'),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(assetPath('webhook')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      layers: [coreLayer],
      environment: {
        SQS_QUEUE_URL: queue.queueUrl,
        NODE_ENV: props.nodeEnv,
        SSM_PREFIX: props.ssmPrefix,
        // Wide events rollout flag (default: enabled). Set to 'false' to revert
        // to legacy scattered logs without redeploying code.
        WIDE_EVENTS_ENABLED: 'true',
        // Rollback action configuration. Values are pulled from SSM by loadConfig.
        ROLLBACK_ACTION_ENABLED: '',
        ROLLBACK_ACTION_ALLOWED_SLACK_USER_IDS: '',
      },
    });
    queue.grantSendMessages(webhookFn);

    // Grant SSM read access to Webhook (needed for Slack signing secret)
    webhookFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['ssm:GetParameter*', 'ssm:DescribeParameters', 'kms:Decrypt'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${props.ssmPrefix}/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter${props.ssmPrefix}`,
        ],
      }),
    );

    // Lambda Function URL — no API Gateway needed
    const fnUrl = webhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // NOTE: APP_URL cannot be injected here — it would create a circular dependency
    // (WebhookLambda → FunctionUrl → WebhookLambda). After first deploy, set it manually:
    //   aws ssm put-parameter --name /junando/app-url --value <WebhookURL output> --type String --overwrite
    // Until then, openrouter.provider.ts falls back to 'https://junando.app' (cosmetic only — HTTP-Referer header)

    // ── Lambda B — SQS Worker ────────────────────────────────────────────────
    const workerFn = new lambda.Function(this, 'WorkerLambda', {
      functionName: resourceName(resourceNamePrefix, 'worker'),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(assetPath('worker')),
      memorySize: 512,
      timeout: cdk.Duration.minutes(3),
      layers: [coreLayer],
      environment: {
        NODE_ENV: props.nodeEnv,
        SSM_PREFIX: props.ssmPrefix,
        // Wide events rollout flag (default: enabled). Set to 'false' to revert
        // to legacy scattered logs without redeploying code.
        WIDE_EVENTS_ENABLED: 'true',
        // DEDUP_STORE deliberately not set — the config default is 'dynamodb'.
        // An operator rolling back sets DEDUP_STORE=redis on the function.
        DEDUP_TABLE_NAME: dedupTable.tableName,
        // Region-derived default, used ONLY when LLM_PROVIDER=bedrock and no
        // explicit LLM_MODEL is set (see resolveLlmModel in @junando/core).
        // Deliberately NOT named LLM_MODEL: that variable is a universal
        // override for every provider, and this value is only valid for
        // Bedrock — setting LLM_MODEL here would force it onto Gemini/Claude/
        // OpenRouter too. Absent entirely when the region has no Bedrock
        // mapping (bedrockModel is undefined).
        ...(bedrockModel ? { BEDROCK_DEFAULT_MODEL: bedrockModel } : {}),
      },
    });

    // Grant SSM read access (robust pattern)
    workerFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['ssm:GetParameter*', 'ssm:DescribeParameters', 'kms:Decrypt'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${props.ssmPrefix}/*`,
          // Some SDK calls might need access to the root or alias
          `arn:aws:ssm:${this.region}:${this.account}:parameter${props.ssmPrefix}`,
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
    dedupTable.grantReadWriteData(workerFn);

    // Grant Bedrock Converse access — only when the region has a mapped
    // Bedrock prefix. No separate IAM action exists for Converse;
    // bedrock:InvokeModel covers it. Two resource ARNs: the inference-profile
    // (region+account scoped — a cross-region inference profile is itself a
    // regional, account-owned resource) and the foundation-model ARN. The
    // foundation-model ARN's region segment is a wildcard, NOT this.region:
    // a 'us.'/'eu.'/'apac.' profile can route the actual inference call to
    // any region in that geography, and AWS's own AccessDeniedException
    // guidance requires InvokeModel on the foundation model in every
    // destination region, not just the one the stack deploys to.
    if (bedrockPrefix) {
      workerFn.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ['bedrock:InvokeModel'],
          resources: [
            `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${bedrockModel}`,
            `arn:aws:bedrock:*::foundation-model/${bedrockFoundationModel}`,
          ],
        }),
      );
    }

    // ── Worker Function URL — /metrics scrape endpoint ──────────────────────
    // IAM auth only: never exposed to anonymous internet traffic. Callers must
    // sign requests with SigV4 (e.g. Grafana sigv4 middleware or aws-sigv4-fetch).
    const workerFnUrl = workerFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // Resource policy: restrict lambda:InvokeFunctionUrl to the monitoring account.
    // Defaults to this account (same-account IAM principals with the identity
    // permission can scrape). Set MONITORING_ACCOUNT_ID at synth time to allow
    // a cross-account monitoring principal — see design.md open questions.
    const monitoringAccountId = process.env['MONITORING_ACCOUNT_ID'] ?? this.account;
    workerFnUrl.grantInvokeUrl(new cdk.aws_iam.AccountPrincipal(monitoringAccountId));

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

    new cdk.CfnOutput(this, 'WorkerMetricsURL', {
      value: `${workerFnUrl.url}metrics`,
      description: 'Worker /metrics endpoint — requires IAM SigV4-signed requests',
    });
  }
}
