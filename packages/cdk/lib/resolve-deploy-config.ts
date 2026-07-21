// Pure function — resolves CDK deployment config with explicit precedence:
// 1. Shell environment variable
// 2. CDK context value
// 3. Hardcoded production default

export interface DeployConfigInputs {
  awsEnv?: string | undefined;
  envNodeEnv?: string | undefined;
  contextNodeEnv?: string | undefined;
  envSsmPrefix?: string | undefined;
  contextSsmPrefix?: string | undefined;
}

export interface DeployConfig {
  nodeEnv: string;
  ssmPrefix: string;
  resourceNamePrefix: string;
}

export enum DeployEnvironment {
  Production = 'production',
  Pilot = 'pilot',
}

const DEFAULT_NODE_ENV = 'production';
const PILOT_NODE_ENV = 'staging';
const DEFAULT_RESOURCE_NAME_PREFIX = 'junando';
const PILOT_RESOURCE_NAME_PREFIX = 'junando-pilot';
const DEFAULT_SSM_PREFIX = '/junando';
const PILOT_SSM_PREFIX = '/junando-pilot';

const ENVIRONMENT_DEFAULTS: Record<string, { nodeEnv: string; ssmPrefix: string }> = {
  [DeployEnvironment.Production]: { nodeEnv: DEFAULT_NODE_ENV, ssmPrefix: DEFAULT_SSM_PREFIX },
  [DeployEnvironment.Pilot]: { nodeEnv: PILOT_NODE_ENV, ssmPrefix: PILOT_SSM_PREFIX },
};

export function resolveResourceNamePrefix(awsEnv?: string): string {
  return awsEnv === DeployEnvironment.Pilot
    ? PILOT_RESOURCE_NAME_PREFIX
    : DEFAULT_RESOURCE_NAME_PREFIX;
}

export function resolveDeployConfig(inputs: DeployConfigInputs): DeployConfig {
  const defaults = ENVIRONMENT_DEFAULTS[inputs.awsEnv ?? DeployEnvironment.Production]
    ?? { nodeEnv: DEFAULT_NODE_ENV, ssmPrefix: DEFAULT_SSM_PREFIX };
  const contextIsProductionDefault = inputs.contextNodeEnv === DEFAULT_NODE_ENV;
  const contextIsProductionSsmDefault = inputs.contextSsmPrefix === DEFAULT_SSM_PREFIX;

  return {
    nodeEnv: inputs.envNodeEnv
      ?? (inputs.awsEnv === DeployEnvironment.Pilot && contextIsProductionDefault
        ? defaults.nodeEnv
        : inputs.contextNodeEnv ?? defaults.nodeEnv),
    ssmPrefix: inputs.envSsmPrefix
      ?? (inputs.awsEnv === DeployEnvironment.Pilot && contextIsProductionSsmDefault
        ? defaults.ssmPrefix
        : inputs.contextSsmPrefix ?? defaults.ssmPrefix),
    resourceNamePrefix: resolveResourceNamePrefix(inputs.awsEnv),
  };
}
