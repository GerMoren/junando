---
'@junando/core': patch
'@junando/ingest': patch
'@junando/webhook': patch
'@junando/worker': patch
'create-junando-app': patch
---

Migrate the build pipeline from tsup to tsdown to support TypeScript 7.0.2. tsup 8.5.1 bundles rollup-plugin-dts 6.1.1, which cannot load TypeScript 7's ESM-only compiler API. tsdown uses rolldown-plugin-dts with the tsgo generator, restoring `.d.ts` emission and the full monorepo build. Refs #177.
