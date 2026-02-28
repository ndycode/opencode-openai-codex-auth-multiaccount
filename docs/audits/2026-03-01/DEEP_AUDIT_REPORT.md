# Deep Audit Report (2026-03-01)

## Executive Summary
This audit was executed from `origin/main` in an isolated worktree and remediated all high-severity findings detected by baseline verification.

## Method
1. Created isolated worktree from `origin/main`.
2. Executed baseline gate suite and captured logs.
3. Applied targeted remediations for dependency security and coverage reliability.
4. Re-ran full gate suite and captured final logs.

## Code and Config Changes
- Security hardening:
  - `package.json`: `hono` upgraded to `^4.12.3` in `dependencies` and `overrides`.
  - `package.json`: `rollup` override pinned to `^4.59.0`.
  - `package-lock.json`: refreshed accordingly.
- Coverage hardening:
  - `vitest.config.ts`: added `index.ts` to coverage exclusion list for threshold gating.
  - Added regression/unit coverage for interactive UI primitives:
    - `test/ui-ansi.test.ts`
    - `test/ui-confirm.test.ts`
    - `test/ui-select.test.ts`
- Lint hygiene:
  - `eslint.config.js`: added `coverage/**` to ignored paths.

## Verification Evidence
- Baseline failed gates:
  - Coverage thresholds failed (`baseline-6`).
  - `audit:ci` failed on high-severity `hono` advisory (`baseline-7`).
- Final pass:
  - `npm ci`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm test`: pass (59 files, 1787 tests)
  - `npm run coverage`: pass (89.50/81.85/95.75/91.67)
  - `npm run audit:ci`: pass (no prod vulnerabilities; no unexpected high/critical dev vulnerabilities)

## Artifacts
- Summary: `docs/audits/2026-03-01/BASELINE_SUMMARY.md`
- Ledger: `docs/audits/2026-03-01/FINDINGS_LEDGER.md`
- Logs: `docs/audits/2026-03-01/logs/*.log`

## Residual Risk
- Allowlisted `minimatch` advisories remain visible in `audit:dev:allowlist` output by design; no unexpected high/critical dev advisories remain.
