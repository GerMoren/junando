# Compatibility Matrix

## Node.js

| Version | Status     | Notes                              |
|---------|------------|------------------------------------|
| 24.x    | ✅ Supported | CI target; Lambda runtime          |
| 22.x    | ⚠️ Best-effort | Not tested in CI                 |
| 20.x    | ❌ Unsupported | `engines` field enforces `>=24` |
| < 20    | ❌ Unsupported |                                  |

> The root `package.json` declares `"node": ">=24.0.0"`. pnpm will refuse installs on older runtimes.

## Module Format

| Package           | ESM | CJS | Notes                                  |
|-------------------|-----|-----|----------------------------------------|
| `@junando/core`   | ✅  | ❌  | `"type": "module"` — ESM only          |
| `@junando/ingest` | ✅  | ✅  | Dual build via tsup (`esm` + `cjs`)    |
| `@junando/webhook`| ✅  | ❌  | ESM only; deployed as Lambda layer     |
| `@junando/worker` | ✅  | ❌  | ESM only; deployed as Lambda layer     |

> All packages target **ES2022** (`tsconfig` `target`). TypeScript declarations are emitted for both ESM and CJS where applicable.

## AWS Lambda Runtime

| Runtime      | Status       | Notes                                    |
|--------------|--------------|------------------------------------------|
| `nodejs24.x` | ✅ Supported  | CDK deploys `NODEJS_24_X` for all Lambdas |
| `nodejs22.x` | ❌ Not tested | CDK stack hardcodes `nodejs24.x`         |
| `nodejs20.x` | ❌ Unsupported|                                          |

## Package Versions

| Package             | Current | Minimum peer |
|---------------------|---------|--------------|
| `@junando/core`     | 0.6.4   | —            |
| `@junando/ingest`   | 0.6.4   | —            |
| `@junando/webhook`  | 0.6.4   | —            |
| `@junando/worker`   | 0.6.4   | —            |

All four packages are versioned in lockstep. Install the same version across packages to avoid type mismatches.

## Key Runtime Dependencies

| Dependency          | Version range | Used by                        |
|---------------------|---------------|--------------------------------|
| `ioredis`           | `^5.10.1`     | `@junando/core`, `@junando/worker` |
| `zod`               | workspace      | all packages                   |
| `@aws-sdk/client-sqs` | `^3.x`      | `@junando/ingest`, `@junando/webhook`, `@junando/worker` |
| `@aws-sdk/client-ssm` | `^3.x`      | `@junando/worker`              |
| `@anthropic-ai/sdk` | workspace      | `@junando/core`                |
| `prom-client`       | `^15.x`        | `@junando/core`                |

## pnpm

| Version | Status     |
|---------|------------|
| ≥ 11.x  | ✅ Supported |
| 9.x–10.x | ⚠️ May work — `packageManager` field declares `11.2.2` |
| < 9     | ❌ Unsupported |

## NestJS

Junando does not depend on NestJS. The packages are framework-agnostic and can be used in any Node.js server (Express, Fastify, NestJS, plain Lambda handlers, etc.).

---

*Last updated: May 2026 — reflects v0.6.4.*
