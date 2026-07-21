import { describe, it, expect } from 'vitest';
import { resolveDeployConfig } from '../resolve-deploy-config.js';

describe('resolveDeployConfig', () => {
  describe('nodeEnv resolution', () => {
    it('uses process.env NODE_ENV when set', () => {
      const result = resolveDeployConfig({
        envNodeEnv: 'staging',
        contextNodeEnv: undefined,
      });
      expect(result.nodeEnv).toBe('staging');
    });

    it('falls back to CDK context when NODE_ENV env var is unset', () => {
      const result = resolveDeployConfig({
        envNodeEnv: undefined,
        contextNodeEnv: 'production',
      });
      expect(result.nodeEnv).toBe('production');
    });

    it('falls back to hardcoded default when neither env nor context is set', () => {
      const result = resolveDeployConfig({
        envNodeEnv: undefined,
        contextNodeEnv: undefined,
      });
      expect(result.nodeEnv).toBe('production');
    });

    it('uses staging for pilot when NODE_ENV and production context default are absent', () => {
      const result = resolveDeployConfig({ awsEnv: 'pilot', contextNodeEnv: 'production' });
      expect(result.nodeEnv).toBe('staging');
    });

    it('preserves an explicit pilot NODE_ENV override', () => {
      const result = resolveDeployConfig({ awsEnv: 'pilot', envNodeEnv: 'production' });
      expect(result.nodeEnv).toBe('production');
    });
  });

  describe('physical resource name resolution', () => {
    it('keeps the default resource names unchanged', () => {
      expect(resolveDeployConfig({}).resourceNamePrefix).toBe('junando');
    });

    it('uses the pilot resource name prefix only for AWS_ENV=pilot', () => {
      expect(resolveDeployConfig({ awsEnv: 'pilot' }).resourceNamePrefix).toBe('junando-pilot');
    });

    it('keeps the default resource names for other AWS environments', () => {
      expect(resolveDeployConfig({ awsEnv: 'dev' }).resourceNamePrefix).toBe('junando');
    });
  });

  describe('ssmPrefix resolution', () => {
    it('uses process.env SSM_PREFIX when set', () => {
      const result = resolveDeployConfig({
        envSsmPrefix: '/junando-staging',
        contextSsmPrefix: undefined,
      });
      expect(result.ssmPrefix).toBe('/junando-staging');
    });

    it('falls back to CDK context when SSM_PREFIX env var is unset', () => {
      const result = resolveDeployConfig({
        envSsmPrefix: undefined,
        contextSsmPrefix: '/junando',
      });
      expect(result.ssmPrefix).toBe('/junando');
    });

    it('falls back to hardcoded default when neither env nor context is set', () => {
      const result = resolveDeployConfig({
        envSsmPrefix: undefined,
        contextSsmPrefix: undefined,
      });
      expect(result.ssmPrefix).toBe('/junando');
    });

    it('uses a safe pilot prefix when SSM_PREFIX is omitted', () => {
      const result = resolveDeployConfig({ awsEnv: 'pilot', contextSsmPrefix: '/junando' });
      expect(result.ssmPrefix).toBe('/junando-pilot');
    });

    it('preserves an explicit pilot SSM_PREFIX override', () => {
      const result = resolveDeployConfig({ awsEnv: 'pilot', envSsmPrefix: '/custom-pilot' });
      expect(result.ssmPrefix).toBe('/custom-pilot');
    });
  });

  describe('shell env wins over CDK context', () => {
    it('env var overrides CDK context for nodeEnv', () => {
      const result = resolveDeployConfig({
        envNodeEnv: 'staging',
        contextNodeEnv: 'production',
      });
      expect(result.nodeEnv).toBe('staging');
    });

    it('env var overrides CDK context for ssmPrefix', () => {
      const result = resolveDeployConfig({
        envSsmPrefix: '/junando-staging',
        contextSsmPrefix: '/junando',
      });
      expect(result.ssmPrefix).toBe('/junando-staging');
    });
  });
});
