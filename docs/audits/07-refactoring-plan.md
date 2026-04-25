> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: refactoring plan

# Refactoring Plan

The old RC-1 and RC-2 recommendations are complete:

- RC-1: tool handlers are extracted to `lib/tools/codex-*.ts`.
- RC-2: storage is split behind the `lib/storage.ts` facade.
- RC-7: account manager is a slim orchestrator over `lib/accounts/*`.

Current incremental plan:

1. Keep request-pipeline changes focused; do not split `fetch-helpers.ts` or `request-transformer.ts` without behavior-driven tests.
2. Add package-smoke automation for `npm pack` in a later PR.
3. Raise branch coverage floors only after focused tests cover the remaining request, UI, and legacy `index.ts` branches.
4. Keep current-structure parity tests updated whenever tool count or registry shape changes.
