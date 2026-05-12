# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **CI**: Updated Node version to 24 to match `.nvmrc`.
- **CI**: Fixed build order to run `pnpm build` before `pnpm typecheck` to resolve monorepo dependencies.
- **Webhook**: Added missing `await` to `loadConfig` calls, fixing critical runtime type errors.
- **Worker**: Fixed SQS message validation by synchronizing `NormalizedAlert` schema and adding `fingerprint` mapping.
- **CDK**: Resolved security warnings by enabling KMS encryption for SQS queues.
- **Scripts**: Refactored `generate-alert.ts` to use top-level await, addressing SonarCloud warnings.
- **IAM**: Expanded Worker Lambda permissions to include `ssm:GetParameter*` and `kms:Decrypt` for secure secret retrieval.

### Added
- **CI**: Added `cdk synth` step to PR validation for safe infrastructure checks.
- **Bundling**: Configured `tsup` to bundle all internal monorepo dependencies (`noExternal: [/./]`) for self-contained Lambda deployments.
- **Scripts**: Added `JUNANDO_WEBHOOK_URL` support to `generate-alert.ts` for production testing.
