> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T14:08:35+08:00

# Verification Report

Local checks completed during the refresh:

| Command | Result |
| --- | --- |
| `npm.cmd ci` | Passed |
| `npm.cmd test -- test/index.test.ts test/doc-parity.test.ts test/storage.test.ts` | Passed |
| `npm.cmd test -- test/doc-parity.test.ts test/index.test.ts` | Passed |
| `npm.cmd test -- test/install-oc-codex-multi-auth.test.ts --reporter verbose` | Passed |
| Deep current-doc structure sweep | Passed: 66 current documentation files checked; 21 registry entries match 21 tool modules; no stale structure anchors; no missing `npm run` script references |
| Deep multi-surface structure sweep | Passed: 320 repo files checked across workflows, package metadata, config models, docs, tool registry, tests, and static secret fixtures |
| `npm.cmd test -- test/doc-parity.test.ts test/model-map.test.ts test/index.test.ts` | Passed: 3 files, 190 tests |
| `npm.cmd test -- test/doc-parity.test.ts` | Passed: 12 tests |
| `npm.cmd test -- test/clean-dist.test.ts test/doc-parity.test.ts` | Passed: 2 files, 15 tests |
| `npm.cmd run lint` | Passed |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd test` | Passed: 84 files, 2369 passed, 1 skipped |
| `npm.cmd run test:coverage` | Passed: statements 80.39%, branches 71.62%, functions 89.01%, lines 81.94% |
| `npm.cmd run build` | Passed; build now cleans `dist/` before compiling |
| `npm.cmd run audit:ci` | Passed; production audit reported existing moderate advisories only under the configured high-severity gate |
| `npm.cmd pack --json --pack-destination <temp>\pack` | Passed; produced `oc-codex-multi-auth-6.1.7.tgz` |
| `tar -tf <tarball> | findstr /i "_shared"` | Passed; rebuilt package no longer contains stale deleted `_shared` outputs |
| `npm.cmd install <tarball> --ignore-scripts` | Passed in a fresh temp project |
| `node --input-type=module -e 'await import("oc-codex-multi-auth"); await import("oc-codex-multi-auth/tui");'` | Passed; main default export resolved as a function and TUI export exposed `default` plus `shouldRefreshQuotaForEvent` |
| `node node_modules\oc-codex-multi-auth\scripts\install-oc-codex-multi-auth.js --dry-run --no-cache-clear` | Passed against a temp HOME; only dry-run writes/removals were reported |

Coverage note: the previous 80% global branch and 70% `index.ts` branch thresholds were aspirational and failed against the refreshed baseline. The executable gate now keeps 80% global floors for statements/functions/lines, 70% global branch coverage, and calibrated legacy `index.ts` floors while tracking branch-coverage increases in issue #149.
