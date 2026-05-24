export interface ParsedArgs {
  projectName: string | undefined;
  help: boolean;
  version: boolean;
  unknownFlag: string | undefined;
}

export function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] = node, argv[1] = script path, rest are user args
  const args = argv.slice(2);
  let projectName: string | undefined;
  let help = false;
  let version = false;
  let unknownFlag: string | undefined;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else if (arg.startsWith('-')) {
      unknownFlag = arg;
    } else if (projectName === undefined) {
      projectName = arg;
    }
  }

  return { projectName, help, version, unknownFlag };
}
