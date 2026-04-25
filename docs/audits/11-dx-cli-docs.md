> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: DX, CLI, docs

# DX, CLI, And Docs

Resolved in this cleanup:

- `codex-help` topic filtering is exact.
- `codex-help` no longer advertises a `metrics` topic without a matching help section.
- `codex-export` defaults to non-destructive overwrite behavior at the tool layer.
- `codex-remove` guidance includes `confirm=true`.
- The minimal config example includes `reasoning.encrypted_content`.
- Architecture and testing docs now describe the 21-tool `lib/tools` layout.

Remaining DX backlog:

- Add package-smoke command docs once automated.
- Consider a machine-readable export mode for backup commands.
- Keep examples using `index=2` clearly marked as examples or prefer interactive usage.
