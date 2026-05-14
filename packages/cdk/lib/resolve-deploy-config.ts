// Pure function — resolves CDK deployment config with explicit precedence:
// 1. Shell environment variable
// 2. CDK context value
// 3. Hardcoded production default

export interface DeployConfigInputs {
  envNodeEnv?: string | undefined;
  contextNodeEnv?: string | undefined;
  envSsmPrefix?: string | undefined;
  contextSsmPrefix?: string | undefined;
}

export interface DeployConfig {
  nodeEnv: string;
  ssmPrefix: string;
}

export function resolveDeployConfig(inputs: DeployConfigInputs): DeployConfig {
  return {
    nodeEnv: inputs.envNodeEnv ?? inputs.contextNodeEnv ?? 'production',
    ssmPrefix: inputs.envSsmPrefix ?? inputs.contextSsmPrefix ?? '/junando',
  };
}
