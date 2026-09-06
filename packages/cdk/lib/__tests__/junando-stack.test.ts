import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JunandoStack } from '../junando-stack.js';

const STAGING_NODE_ENV = 'staging';
const STAGING_SSM_PREFIX = '/junando-staging';
const DEFAULT_SSM_PREFIX = '/junando';
const STAGING_SSM_RESOURCE = 'arn:aws:ssm:us-east-1:123456789012:parameter/junando-staging/*';
const DEFAULT_SSM_RESOURCE = 'arn:aws:ssm:us-east-1:123456789012:parameter/junando/*';
const DEFAULT_RESOURCE_NAMES = {
  layer: 'junando-core-layer',
  dlq: 'junando-alerts-dlq.fifo',
  queue: 'junando-alerts.fifo',
  webhook: 'junando-webhook',
  worker: 'junando-worker',
};
const PILOT_RESOURCE_NAMES = {
  layer: 'junando-pilot-core-layer',
  dlq: 'junando-pilot-alerts-dlq.fifo',
  queue: 'junando-pilot-alerts.fifo',
  webhook: 'junando-pilot-webhook',
  worker: 'junando-pilot-worker',
};

function isReference(value: unknown): value is { Ref: string } {
  return typeof value === 'object' && value !== null && 'Ref' in value && typeof value.Ref === 'string';
}

function resourceProperties(template: Template) {
  const functions = Object.values(template.findResources('AWS::Lambda::Function'));
  const layers = Object.values(template.findResources('AWS::Lambda::LayerVersion'));
  const queues = Object.values(template.findResources('AWS::SQS::Queue'));
  return {
    functions: functions.map((resource) => resource.Properties.FunctionName),
    layer: layers[0]?.Properties.LayerName,
    queues: queues.map((resource) => resource.Properties.QueueName),
  };
}

describe('JunandoStack staging configuration', () => {
  it('propagates staging values and scopes both Lambda roles to the staging SSM prefix', () => {
    const originalCwd = process.cwd();
    process.chdir(path.resolve(process.cwd(), 'packages/cdk'));

    const app = new App();
    const stack = new JunandoStack(app, 'JunandoStack-staging', {
      env: { account: '123456789012', region: 'us-east-1' },
      nodeEnv: STAGING_NODE_ENV,
      ssmPrefix: STAGING_SSM_PREFIX,
    });
    const template = Template.fromStack(stack);
    process.chdir(originalCwd);

    const functions = Object.values(template.findResources('AWS::Lambda::Function'));
    expect(functions).toHaveLength(2);
    expect(functions.every((fn) =>
      fn.Properties.Environment.Variables.NODE_ENV === STAGING_NODE_ENV &&
      fn.Properties.Environment.Variables.SSM_PREFIX === STAGING_SSM_PREFIX,
    )).toBe(true);

    const ssmPolicies = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) => JSON.stringify(policy).includes(STAGING_SSM_RESOURCE));
    expect(ssmPolicies).toHaveLength(2);
  });

  it('preserves the default SSM prefix resource ARN', () => {
    const originalCwd = process.cwd();
    process.chdir(path.resolve(process.cwd(), 'packages/cdk'));

    const app = new App();
    const stack = new JunandoStack(app, 'JunandoStack-default', {
      env: { account: '123456789012', region: 'us-east-1' },
      nodeEnv: 'production',
      ssmPrefix: DEFAULT_SSM_PREFIX,
    });
    const template = Template.fromStack(stack);
    process.chdir(originalCwd);

    const ssmPolicies = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) => JSON.stringify(policy).includes(DEFAULT_SSM_RESOURCE));
    expect(ssmPolicies).toHaveLength(2);

    expect(resourceProperties(template)).toEqual({
      functions: expect.arrayContaining([DEFAULT_RESOURCE_NAMES.webhook, DEFAULT_RESOURCE_NAMES.worker]),
      layer: DEFAULT_RESOURCE_NAMES.layer,
      queues: expect.arrayContaining([DEFAULT_RESOURCE_NAMES.dlq, DEFAULT_RESOURCE_NAMES.queue]),
    });
  });

  it('uses isolated physical names for the pilot without changing construct IDs', () => {
    const originalCwd = process.cwd();
    process.chdir(path.resolve(process.cwd(), 'packages/cdk'));

    const app = new App();
    const stack = new JunandoStack(app, 'JunandoStack-pilot', {
      env: { account: '123456789012', region: 'us-east-1' },
      nodeEnv: 'staging',
      ssmPrefix: '/junando-pilot',
      resourceNamePrefix: 'junando-pilot',
    });
    const template = Template.fromStack(stack);
    process.chdir(originalCwd);

    expect(resourceProperties(template)).toEqual({
      functions: expect.arrayContaining([PILOT_RESOURCE_NAMES.webhook, PILOT_RESOURCE_NAMES.worker]),
      layer: PILOT_RESOURCE_NAMES.layer,
      queues: expect.arrayContaining([PILOT_RESOURCE_NAMES.dlq, PILOT_RESOURCE_NAMES.queue]),
    });
    expect(Object.keys(template.findResources('AWS::Lambda::Function'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^WebhookLambda/)]),
    );
    expect(Object.keys(template.findResources('AWS::SQS::Queue'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^AlertQueue/)]),
    );
  });
});

describe('JunandoStack dedup table', () => {
  function buildTemplate() {
    const originalCwd = process.cwd();
    process.chdir(path.resolve(process.cwd(), 'packages/cdk'));

    const app = new App();
    const stack = new JunandoStack(app, 'JunandoStack-dedup', {
      env: { account: '123456789012', region: 'us-east-1' },
      nodeEnv: 'production',
      ssmPrefix: DEFAULT_SSM_PREFIX,
    });
    const template = Template.fromStack(stack);
    process.chdir(originalCwd);
    return template;
  }

  it('creates exactly one PROVISIONED 25/25 table with no autoscaling', () => {
    const template = buildTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      // CDK omits BillingMode from the template for PROVISIONED (the CFN
      // default); ProvisionedThroughput's presence is the equivalent proof.
      ProvisionedThroughput: { ReadCapacityUnits: 25, WriteCapacityUnits: 25 },
      KeySchema: [{ AttributeName: 'fingerprint', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 0);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('grants read/write only to the worker role, not the webhook role', () => {
    const template = buildTemplate();

    const functions = template.findResources('AWS::Lambda::Function');
    const workerEntry = Object.values(functions).find(
      (fn) => fn.Properties.FunctionName === DEFAULT_RESOURCE_NAMES.worker,
    );
    const workerRoleLogicalId = workerEntry?.Properties.Role['Fn::GetAtt'][0];
    expect(workerRoleLogicalId).toBeTruthy();

    const dedupPolicies = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) => JSON.stringify(policy).includes('dynamodb:PutItem'));
    expect(dedupPolicies).toHaveLength(1);

    const dedupPolicy = dedupPolicies[0];
    if (!dedupPolicy) throw new Error('expected exactly one dedup policy');
    const roleRefs = (dedupPolicy.Properties.Roles as unknown[])
      .filter(isReference)
      .map((role) => role.Ref);
    expect(roleRefs).toContain(workerRoleLogicalId);
  });

  it('sets DEDUP_TABLE_NAME on the worker environment and not on the webhook environment', () => {
    const template = buildTemplate();

    const functions = Object.values(template.findResources('AWS::Lambda::Function'));
    const workerEntry = functions.find(
      (fn) => fn.Properties.FunctionName === DEFAULT_RESOURCE_NAMES.worker,
    );
    const webhookEntry = functions.find(
      (fn) => fn.Properties.FunctionName === DEFAULT_RESOURCE_NAMES.webhook,
    );

    expect(workerEntry?.Properties.Environment.Variables.DEDUP_TABLE_NAME).toBeTruthy();
    expect(webhookEntry?.Properties.Environment.Variables.DEDUP_TABLE_NAME).toBeUndefined();
  });
});
