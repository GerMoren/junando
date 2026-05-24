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
    `  ${CYAN}cp .env.example .env${RESET}   # edit with your LLM/Slack keys`,
    `  ${CYAN}pnpm dev${RESET}`,
    '',
    `See ${targetDir}/app/README.md for more details.`,
    '',
  ].join('\n');
}
