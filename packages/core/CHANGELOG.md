# @junando/core

## 0.10.1

### Patch Changes

- 38423c6: refactor: replace all switch/case with maps and FactoryRegistry.

  Zero switch/case statements remaining in the codebase. Added FactoryRegistry generic class in shared/factory-registry.ts for adapter resolution. Refactored notifier factory, metric-to-alert.mapper evaluate() function, and sqs-subscriber test helpers to use map patterns instead of switch/case. Closes #137.

## 0.10.0

## 0.9.0

## 0.8.3

## 0.8.2

### Patch Changes

- f69466a: chore: validate OIDC + provenance via NPM_CONFIG_PROVENANCE env var (#110)

## 0.8.1

### Patch Changes

- 66c6701: chore: validate OIDC trusted publishing with provenance attestation (#110)

## 0.8.0
