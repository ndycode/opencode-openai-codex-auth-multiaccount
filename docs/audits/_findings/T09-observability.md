---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T09 observability
generated: 2026-04-25T12:45:33+08:00
---

# T09 Observability

Current observability surfaces:

- Runtime metrics are exposed through `codex-metrics`.
- Health is exposed through `codex-health` and `codex-doctor`.
- Request logging is opt-in through environment variables.
- Debug logs live under the OpenCode plugin log root.

Residual note: request body logging can contain sensitive payloads. Documentation should keep that warning explicit.
