const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';

export function buildNextStepsMessage(targetDir: string): string {
  return [
    '',
    `${GREEN}${BOLD}✔ Scaffolded ${targetDir} successfully!${RESET}`,
    '',
    `${BOLD}Next steps:${RESET}`,
    `  ${CYAN}cd ${targetDir}/app${RESET}`,
    `  ${CYAN}pnpm dev${RESET}`,
    '',
    `Your ${CYAN}.env${RESET} was created from ${CYAN}.env.example${RESET} with placeholder values.`,
    `Edit it with your real LLM/Slack keys when you wire the full pipeline.`,
    '',
    `See ${targetDir}/app/README.md for more details.`,
    '',
  ].join('\n');
}
