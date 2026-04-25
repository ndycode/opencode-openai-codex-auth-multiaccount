---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T13 test coverage
generated: 2026-04-25T12:45:33+08:00
---

# T13 Test Coverage

Current count: 83 `*.test.ts` files.

New or relevant guards:

- `test/doc-parity.test.ts` covers runtime docs, config examples, live tool registry, and stale audit anchors.
- `test/index.test.ts` covers plugin-level tool wiring and the updated `codex-help`, `codex-export`, and `codex-remove` behavior.
- `test/storage.test.ts` covers non-destructive storage export defaults.
- `vitest.config.ts` enforces executable coverage floors: 80% statements/functions/lines globally, a 70% global branch floor, and calibrated legacy `index.ts` floors.

Remaining gaps: package-smoke verification is still a manual command sequence, and branch coverage should be raised with focused tests.
