# Baseline and Final Gate Summary (2026-03-01)

## Scope
- Baseline commit: `ab970af6c28dca75aa90385e0bdc376743a5176b` (`origin/main`)
- Audit branch: `audit/deep-main-20260301-full`
- Worktree: `../oc-chatgpt-multi-auth-audit-main-20260301`

## Baseline Run (Before Fixes)

| Step | Command | Exit Code | Log |
| --- | --- | --- | --- |
| baseline-1 | `npm ci` | 0 | `docs/audits/2026-03-01/logs/baseline-1-npm-ci.log` |
| baseline-2 | `npm run lint` | 0 | `docs/audits/2026-03-01/logs/baseline-2-npm-run-lint.log` |
| baseline-3 | `npm run typecheck` | 0 | `docs/audits/2026-03-01/logs/baseline-3-npm-run-typecheck.log` |
| baseline-4 | `npm run build` | 0 | `docs/audits/2026-03-01/logs/baseline-4-npm-run-build.log` |
| baseline-5 | `npm test` | 0 | `docs/audits/2026-03-01/logs/baseline-5-npm-test.log` |
| baseline-6 | `npm run coverage` | 1 | `docs/audits/2026-03-01/logs/baseline-6-npm-run-coverage.log` |
| baseline-7 | `npm run audit:ci` | 1 | `docs/audits/2026-03-01/logs/baseline-7-npm-run-audit-ci.log` |

### Baseline Failures
1. Coverage thresholds failed:
   - Statements: 77.05% (< 80)
   - Branches: 68.25% (< 80)
   - Lines: 78.40% (< 80)
2. `audit:ci` failed due to `hono` high-severity advisory (`GHSA-xh87-mx6m-69f3`).

## Final Verification Run (After Fixes)

| Step | Command | Exit Code | Log |
| --- | --- | --- | --- |
| final-1 | `npm ci` | 0 | `docs/audits/2026-03-01/logs/final-1-npm-ci.log` |
| final-2 | `npm run lint` | 0 | `docs/audits/2026-03-01/logs/final-2-npm-run-lint.log` |
| final-3 | `npm run typecheck` | 0 | `docs/audits/2026-03-01/logs/final-3-npm-run-typecheck.log` |
| final-4 | `npm run build` | 0 | `docs/audits/2026-03-01/logs/final-4-npm-run-build.log` |
| final-5 | `npm test` | 0 | `docs/audits/2026-03-01/logs/final-5-npm-test.log` |
| final-6 | `npm run coverage` | 0 | `docs/audits/2026-03-01/logs/final-6-npm-run-coverage.log` |
| final-7 | `npm run audit:ci` | 0 | `docs/audits/2026-03-01/logs/final-7-npm-run-audit-ci.log` |
| final-8 | `npm run lint` (post ignore hardening) | 0 | `docs/audits/2026-03-01/logs/final-8-npm-run-lint-post-ignore.log` |

### Final Coverage Snapshot
- Statements: 89.50%
- Branches: 81.85%
- Functions: 95.75%
- Lines: 91.67%

## Remaining Notable Signals
- `audit:dev:allowlist` still reports allowlisted `minimatch` advisories (expected policy behavior), with no unexpected high/critical dev vulnerabilities.
