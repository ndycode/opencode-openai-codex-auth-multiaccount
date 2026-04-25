---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T06 filesystem
generated: 2026-04-25T12:45:33+08:00
---

# T06 Filesystem

Current filesystem ownership:

- `lib/storage/paths.ts` resolves config roots.
- `lib/storage/load-save.ts` handles account load/save and transactions.
- `lib/storage/atomic-write.ts` implements atomic write primitives.
- `lib/storage/worktree-lock.ts` coordinates lock behavior.
- `lib/storage/export-import.ts` validates import/export safety.

Resolved:

- Export overwrite defaults are non-destructive.
- Minimal config now includes the stateless continuity field.

Residual low risk: package-smoke install tests are manual rather than scripted.
