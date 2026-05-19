# How to implement a mapper for Junando

A **mapper** bridges the gap between a specific SQS message schema (owned by a client) and the generic Junando domain types. It must implement `IMessageMapper` from `@junando/ingest`.

## Interface

```ts
export interface IMessageMapper {
  readonly kind: string; // unique string ID for config (e.g. 'my-client-v1')
  decode(message: Message): unknown; // parse + validate the raw SQS body — throw on invalid
  toNormalizedAlerts(decoded: unknown): NormalizedAlert[]; // for notification path
  toTraceabilityDocument(decoded: unknown, message: Message): TraceabilityDocument; // for indexer path
  resolveCorrelationId(decoded: unknown, message: Message): string; // groups related events
}
```

## Minimal example

```ts
// my-client-v1.mapper.ts
import type { Message } from '@aws-sdk/client-sqs';
import { AlertType, type NormalizedAlert } from '@junando/core';
import type { TraceabilityDocument } from '@junando/core';
import { registerMapper, type IMessageMapper } from '@junando/ingest';

interface MyClientPayload {
  eventId: string;
  service: string;
  errorMessage: string;
  occurredAt: string;
}

function isMyClientPayload(v: unknown): v is MyClientPayload {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['eventId'] === 'string' &&
    typeof r['service'] === 'string' &&
    typeof r['errorMessage'] === 'string'
  );
}

const myClientV1Mapper: IMessageMapper = {
  kind: 'my-client-v1',

  decode(message: Message): MyClientPayload {
    if (!message.Body?.trim()) throw new Error('Missing SQS body');
    let raw: unknown;
    try {
      raw = JSON.parse(message.Body);
    } catch (e) {
      throw new Error(`Invalid JSON: ${e}`);
    }
    if (!isMyClientPayload(raw)) throw new Error('Unexpected payload shape');
    return raw;
  },

  toNormalizedAlerts(decoded: unknown): NormalizedAlert[] {
    const p = decoded as MyClientPayload;
    return [
      {
        fingerprint: /* sha256 of relevant fields */ p.eventId,
        alertName: `${p.service}Error`,
        status: 'firing',
        serviceName: p.service,
        alertType: AlertType.Error,
        endpointPath: '',
        startsAt: p.occurredAt,
        labels: { source: 'my-client', service: p.service },
        annotations: { message: p.errorMessage },
      },
    ];
  },

  toTraceabilityDocument(decoded: unknown, message: Message): TraceabilityDocument {
    const p = decoded as MyClientPayload;
    return {
      '@timestamp': p.occurredAt,
      application: p.service,
      channel: 'default',
      messageType: 'error',
      message: p.errorMessage,
      fingerprint: p.eventId,
      correlationId: p.eventId,
    };
  },

  resolveCorrelationId(decoded: unknown, message: Message): string {
    const p = decoded as MyClientPayload;
    return p.eventId || message.MessageId || 'generic';
  },
};

// Register once at module load
registerMapper(myClientV1Mapper);
```

## Registering in your deployment

In your deployment entry point (or your own `ingest-server.ts`), import your mapper **before** calling `createIngestRuntime`:

```ts
import './my-client-v1.mapper.js'; // side-effect: registers the mapper

import { createIngestRuntime } from '@junando/ingest'; // or the scripts path

createIngestRuntime({ ingestConfig, logger /* ... */ });
```

## Config YAML

```yaml
ingest:
  kind: sqs
  sqs:
    queueUrl: https://sqs.us-east-1.amazonaws.com/123456789012/my-client-errors
  mapper:
    kind: my-client-v1 # must match the mapper's `kind` field
```

## Reference implementation

See `ps-cencopim-ecosystem-error-manager` (or the issue linked in #35) for a real-world example of a mapper that handles the Cenco error-management SQS message schema.
