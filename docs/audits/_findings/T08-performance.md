---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T08 performance
generated: 2026-04-25T12:45:33+08:00
---

# T08 Performance

Current likely performance-sensitive areas:

- SSE parsing in `lib/request/response-handler.ts`.
- Prompt template cache in `lib/prompts/codex.ts`.
- Health and account probes in `lib/parallel-probe.ts`.
- Request transformation in `lib/request/request-transformer.ts`.

No benchmark was run as part of this doc refresh. Keep future performance claims behind direct measurement.
