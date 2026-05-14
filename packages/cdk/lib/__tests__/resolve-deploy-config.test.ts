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
