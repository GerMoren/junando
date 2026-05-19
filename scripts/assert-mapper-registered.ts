import type { IngestConfig } from "../packages/ingest/src/index.js";
import type { Logger } from "../packages/core/src/index.js";
import { getMapper } from "./ingest/mappers/registry.js";

/**
 * Pre-flight guard: verify mapper kind is registered before SQS runtime starts.
 * No-op for non-SQS ingest kinds. Calls exit(1) on failure after a fatal log.
 */
export function assertMapperRegistered(
  ingestConfig: IngestConfig,
  logger: Pick<Logger, "fatal">,
  exit: (code: number) => never = process.exit,
): void {
  if (ingestConfig.ingest.kind !== "sqs") {
    return;
  }

  const mapperKind = ingestConfig.ingest.mapper.kind;

  try {
    getMapper(mapperKind);
  } catch {
    logger.fatal(
      { mapperKind },
      `Mapper not registered: "${mapperKind}". Register it via registerMapper() before starting the runtime.`,
    );
    exit(1);
  }
}
