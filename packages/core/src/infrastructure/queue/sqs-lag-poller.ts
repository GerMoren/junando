import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { sqsQueueLag } from '../../shared/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// startSqsLagPoller — Background poller for SQS queue depth.
// Polls ApproximateNumberOfMessages and updates the sqsQueueLag gauge.
// Must NOT be called in the webhook critical path — worker module scope only.
//
// Returns a cleanup function (clearInterval) for test teardown / Lambda shutdown.
// ─────────────────────────────────────────────────────────────────────────────

export function startSqsLagPoller(
  queueUrl: string,
  intervalMs: number,
  region?: string,
): () => void {
  const client = new SQSClient(region ? { region } : {});

  const poll = async (): Promise<void> => {
    try {
      const result = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      );
      const raw = result.Attributes?.['ApproximateNumberOfMessages'];
      if (raw !== undefined) {
        sqsQueueLag.set({ queue_name: 'alerts' }, parseInt(raw, 10));
      }
    } catch {
      // Swallow errors: gauge retains last value; process must not exit.
    }
  };

  const timer = setInterval(() => {
    void poll();
  }, intervalMs);

  return () => clearInterval(timer);
}
