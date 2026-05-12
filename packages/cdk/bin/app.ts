#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import 'source-map-support/register';
import { JunandoStack } from '../lib/junando-stack.js';

const app = new cdk.App();
const env = process.env['AWS_ENV'] ?? 'dev';

new JunandoStack(app, `JunandoStack-${env}`, {
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'] ?? '000000000000',
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
  tags: { project: 'junando', environment: env },
});
