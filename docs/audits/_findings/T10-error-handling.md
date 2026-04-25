---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T10 error handling
generated: 2026-04-25T12:45:33+08:00
---

# T10 Error Handling

Resolved in this cleanup:

- `codex-help` no longer treats substring topic matches as valid topics.
- `codex-help` advertised topics now match the section keys exposed by `lib/tools/codex-help.ts`.
- `codex-export` no longer opts into overwrite by default.
- `codex-remove` no-op guidance includes the required confirmation argument.

Current error handling remains split across typed errors, storage errors, circuit-breaker states, and user-facing tool strings. No active Critical or High error-handling blocker remains.
