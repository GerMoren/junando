#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import 'source-map-support/register';
import { JunandoStack } from '../lib/junando-stack.js';
import { resolveDeployConfig } from '../lib/resolve-deploy-config.js';

const app = new cdk.App();
const env = process.env['AWS_ENV'] ?? 'dev';

const { nodeEnv, ssmPrefix } = resolveDeployConfig({
  envNodeEnv: process.env['NODE_ENV'],
  contextNodeEnv: app.node.tryGetContext('nodeEnv') as string | undefined,
  envSsmPrefix: process.env['SSM_PREFIX'],
  contextSsmPrefix: app.node.tryGetContext('ssmPrefix') as string | undefined,
});

new JunandoStack(app, `JunandoStack-${env}`, {
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'] ?? '000000000000',
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
  tags: { project: 'junando', environment: env },
  nodeEnv,
  ssmPrefix,
});
