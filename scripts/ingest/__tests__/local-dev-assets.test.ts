import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIngestConfig } from "../../../packages/ingest/src/config/ingest-config.schema.js";

const repoRoot = resolve(import.meta.dirname, "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

describe("Work Unit 3 local-dev assets", () => {
  it("provides a checked-in generic SQS example config", () => {
    const path = resolve(repoRoot, "docker/ingest.config.sqs.example.yaml");
    expect(existsSync(path)).toBe(true);

    const config = loadIngestConfig(readRepoFile("docker/ingest.config.sqs.example.yaml"));
    expect(config.ingest.kind).toBe("sqs");
    if (config.ingest.kind !== "sqs") throw new Error("Expected sqs ingest config");

    expect(config.ingest.sqs.queueUrl).toMatch(/^https:\/\//);
  });

  it("provides a LocalStack-friendly SQS local config", () => {
    const path = resolve(repoRoot, "docker/ingest.config.sqs.local.yaml");
    expect(existsSync(path)).toBe(true);

    const config = loadIngestConfig(readRepoFile("docker/ingest.config.sqs.local.yaml"));
    expect(config.ingest.kind).toBe("sqs");
    if (config.ingest.kind !== "sqs") throw new Error("Expected sqs ingest config");

    expect(config.ingest.sqs.queueUrl).toContain("localhost:4566");
    expect(config.ingest.sqs.endpointUrl).toBe("http://localhost:4566");
  });

  it("ships a dedicated LocalStack compose file and queue bootstrap script", () => {
    const composePath = resolve(repoRoot, "docker/docker-compose.localstack.yml");
    const bootstrapPath = resolve(repoRoot, "docker/localstack/init/10-create-sqs-queue.sh");

    expect(existsSync(composePath)).toBe(true);
    expect(existsSync(bootstrapPath)).toBe(true);

    const compose = readRepoFile("docker/docker-compose.localstack.yml");
    expect(compose).toContain("localstack:");
    expect(compose).toContain("'4566:4566'");

    const bootstrap = readRepoFile("docker/localstack/init/10-create-sqs-queue.sh");
    expect(bootstrap).toContain("awslocal sqs create-queue");
    expect(bootstrap).toContain("junando-cenco-phase-a");
  });

  it("documents a local SQS runner command and bundles script-level ingest runtime files in the ingest image", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["ingest:sqs:local"]).toBe(
      "tsx --env-file=.env.local scripts/ingest-server.ts",
    );

    const dockerfile = readRepoFile("docker/Dockerfile.ingest");
    expect(dockerfile).toContain("COPY scripts/ingest/ ./scripts/ingest/");
  });
});
