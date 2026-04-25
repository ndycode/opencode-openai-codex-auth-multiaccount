---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T12 cli ui
generated: 2026-04-25T12:45:33+08:00
---

# T12 CLI UI

Current tool registry:

- 21 `codex-*` tools in `lib/tools/codex-*.ts`.
- Registry map in `lib/tools/index.ts`.
- Plugin attachment through `createToolRegistry(ctx)`.

Resolved:

- `codex-help` uses exact topic keys.
- `codex-export` defaults to non-destructive overwrite behavior.
- `codex-remove` usage guidance includes `confirm=true`.

Residual low-priority item: some examples still use `index=2` as a placeholder. Keep destructive examples explicit.
