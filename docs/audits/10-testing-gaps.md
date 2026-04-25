> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: testing gaps

# Testing Gaps

Current high-value coverage:

- Tool registration and extracted tool behavior are exercised through `test/index.test.ts`.
- Focused tool regressions are validated in `test/tools-codex-*.test.ts`.
- Non-destructive export defaults are checked in `test/storage.test.ts`.
- `test/doc-parity.test.ts` now asserts the config contract, tool registry count, and stale audit anchors.
- Response shapes are pinned in `test/contracts/*`.

Remaining gaps:

- Package-smoke automation is still manual.
- Branch coverage is below the aspirational 80% floor; the executable gate is calibrated to the current baseline.
- Large request modules have broad tests, but not per-subdomain ownership tests.
