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
    process.chdir(path.resolve(import.meta.dirname, '../..'));

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
    process.chdir(path.resolve(import.meta.dirname, '../..'));

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
    process.chdir(path.resolve(import.meta.dirname, '../..'));

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
