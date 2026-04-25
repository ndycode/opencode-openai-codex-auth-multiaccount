---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T01 architecture
generated: 2026-04-25T12:45:33+08:00
---

# T01 Architecture

Current structure:

- `index.ts`: 3694 lines, context wiring and request pipeline.
- `lib/tools/index.ts`: `ToolContext` plus registry for 21 per-file tools.
- `lib/storage.ts`: 79-line facade over focused storage modules.
- `lib/accounts.ts`: orchestrator over state, persistence, rotation, and recovery modules.
- `lib/recovery/index.ts`: barrel including hook, storage, constants, and types.

Resolved:

- Tool handlers are no longer inline in `index.ts`.
- Storage is no longer a single implementation file.
- Account manager responsibilities have been split behind a stable facade.

Current architecture backlog:

- `lib/request/request-transformer.ts` and `lib/request/fetch-helpers.ts` remain large. Split only with behavior-driven tests.
