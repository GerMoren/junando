// Re-export from @junando/ingest public API.
// Scripts inside this repo import from here; external client repos
// should import directly from '@junando/ingest'.
export { getMapper, registerMapper } from "@junando/ingest";
export type { IMessageMapper } from "@junando/ingest";
