#!/usr/bin/env tsx
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const isCi = process.argv.includes('--ci');
const rootDir = process.cwd();
const tmpDir = path.join(rootDir, 'tmp');
const envFile = path.join(tmpDir, '.env.quickstart');
const webhookUrl = 'http://localhost:4000/webhook/alert';
const healthUrl = 'http://localhost:4000/health';

function run(command: string, args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', (err) => reject(new Error(`${label} failed to start: ${String(err)}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Webhook did not become healthy within ${timeoutMs}ms`);
}

async function createQuickstartEnvFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  const content = `LLM_PROVIDER=gemini
LLM_API_KEY=dummy-key
NOTIFIER_TYPE=teams
TEAMS_WEBHOOK_URL=https://example.com/junando?api-version=2024-10-01
LOKI_URL=http://localhost:3100
REDIS_URL=redis://localhost:6379
NODE_ENV=development
LOG_LEVEL=info
JUNANDO_WEBHOOK_URL=${webhookUrl}
`;

  await writeFile(filePath, content, 'utf8');
}

function buildSyntheticPayload() {
  const now = new Date();
  const endsAt = new Date(now.getTime() + 60_000);

  return {
    version: '4',
    groupKey: '{alertname="QuickstartSyntheticAlert"}',
    status: 'firing',
    receiver: 'junando',
    groupLabels: { alertname: 'QuickstartSyntheticAlert' },
    commonLabels: { severity: 'warning' },
    commonAnnotations: {},
    externalURL: 'http://localhost:9093',
    alerts: [
      {
        status: 'firing',
        labels: {
          alertname: 'QuickstartSyntheticAlert',
          service: 'quickstart-service',
          error_type: 'latency_ms',
          endpoint: '/api/quickstart',
          severity: 'warning',
        },
        annotations: {
          summary: 'Synthetic quickstart alert to validate webhook flow',
        },
        startsAt: now.toISOString(),
        endsAt: endsAt.toISOString(),
        fingerprint: randomUUID().slice(0, 8),
      },
    ],
  };
}

async function postSyntheticAlert(): Promise<void> {
  const payload = buildSyntheticPayload();
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook request failed: ${response.status} ${text}`);
  }

  const body = (await response.json()) as { accepted?: number; correlationId?: string };
  if (typeof body.accepted !== 'number' || body.accepted < 1) {
    throw new Error('Webhook response did not include an accepted alert count');
  }
}

function startWebhook(envFilePath: string): ChildProcess {
  return spawn('pnpm', ['exec', 'tsx', `--env-file=${envFilePath}`, 'scripts/dev-server.ts'], {
    stdio: 'inherit',
    env: process.env,
  });
}

async function main(): Promise<void> {
  console.log('🔎 Quickstart smoke: building core package...');
  await run('pnpm', ['--filter', '@junando/core', 'build'], 'core build');

  if (!existsSync(path.join(rootDir, '.env.local')) || isCi) {
    await createQuickstartEnvFile(envFile);
    console.log(`🧪 Using generated env file: ${path.relative(rootDir, envFile)}`);
  } else {
    await createQuickstartEnvFile(envFile);
    console.log(`🧪 Using generated env file: ${path.relative(rootDir, envFile)} (without touching .env.local)`);
  }

  const webhook = startWebhook(envFile);

  try {
    console.log('⏳ Waiting for webhook health endpoint...');
    await waitForHealth(healthUrl, 30_000);

    console.log('📨 Sending synthetic alert...');
    await postSyntheticAlert();

    console.log('✅ Quickstart smoke passed. Webhook accepted a synthetic alert.');
  } finally {
    webhook.kill('SIGTERM');
    await rm(envFile, { force: true });
  }
}

main().catch((err) => {
  console.error('❌ Quickstart smoke failed.');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
