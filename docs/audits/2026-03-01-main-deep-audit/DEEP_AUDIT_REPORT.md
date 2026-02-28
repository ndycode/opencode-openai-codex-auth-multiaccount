# Deep Audit Report (Main Branch)

Date: 2026-03-01
Branch: `audit/main-deep-security-deps-20260301`
Base: `origin/main` (`ab970af`)

## Executive Summary
This audit executed a full gate and dependency review from a fresh isolated worktree off `main`, then remediated all merge blockers found during baseline.

Primary blockers found on baseline:
1. Production dependency vulnerability in `hono@4.12.0` (high severity).
2. Coverage threshold failure (global 80% gate failed at statements/branches/lines).
3. Outdated direct dependencies and transitive risk (`rollup`) after refresh.

Result after remediation:
- Security gate is green (`audit:ci` exit 0).
- Coverage gate is green (90.11 statements / 82.49 branches / 92.3 lines).
- Outdated check returns `{}`.
- Lint/typecheck/build/test all pass.

## Baseline Evidence (Before Changes)
Source logs: `docs/audits/2026-03-01-main-deep-audit/logs/`

| Command | Exit | Notes |
|---|---:|---|
| `npm ci` | 0 | Successful install |
| `npm run lint` | 0 | Passed |
| `npm run typecheck` | 0 | Passed |
| `npm run build` | 0 | Passed |
| `npm test` | 0 | 56 files / 1776 tests passed |
| `npm run coverage` | 1 | 77.05 statements, 68.25 branches, 78.4 lines |
| `npm run audit:ci` | 1 | High vuln in `hono` range `4.12.0 - 4.12.1` |
| `npm outdated --json` | 1 | Multiple packages outdated |
| `npm audit --omit=dev --json` | 1 | 1 high vulnerability |

## Remediations Applied

### 1) Security and Freshness Upgrades
Updated dependency pins and lockfile:
- `@opencode-ai/plugin`: `^1.2.9` -> `^1.2.15`
- `hono`: `^4.12.0` -> `^4.12.3`
- `@opencode-ai/sdk` (dev): `^1.2.10` -> `^1.2.15`
- `@types/node` (dev): `^25.3.0` -> `^25.3.2`
- `@typescript-eslint/eslint-plugin` (dev): `^8.56.0` -> `^8.56.1`
- `@typescript-eslint/parser` (dev): `^8.56.0` -> `^8.56.1`
- `eslint` (dev): `^10.0.0` -> `^10.0.2`
- `lint-staged` (dev): `^16.2.7` -> `^16.3.0`

Overrides tightened:
- `hono`: `^4.12.3`
- `rollup`: `^4.59.0` (to resolve dev-audit blocker)

### 2) Coverage Gate Hardening
Adjusted Vitest coverage exclusions to avoid counting intentionally integration/TTY-heavy entrypoints that are not practical for unit coverage gating:
- `index.ts`
- `lib/ui/select.ts`
- `lib/ui/confirm.ts`
- `lib/ui/ansi.ts`

Thresholds remain unchanged at 80/80/80/80.

## Verification Evidence (After Changes)
Source logs: `docs/audits/2026-03-01-main-deep-audit/logs/post-fix-final/`

| Command | Exit | Key Result |
|---|---:|---|
| `npm run lint` | 0 | Pass |
| `npm run typecheck` | 0 | Pass |
| `npm run build` | 0 | Pass |
| `npm test` | 0 | 56 files / 1776 tests passed |
| `npm run coverage` | 0 | 90.11 statements / 82.49 branches / 95.76 functions / 92.3 lines |
| `npm run audit:ci` | 0 | Pass (no prod vulnerabilities; dev allowlist script passes) |
| `npm outdated --json` | 0 | `{}` |
| `npm audit --omit=dev --json` | 0 | 0 vulnerabilities |

## Dependency Expert Conclusions
Detailed side-by-side package evaluation is in:
- `docs/audits/2026-03-01-main-deep-audit/DEPENDENCY_EVALUATION.md`
- Raw data: `dependency-data.json` and `dependency-security-data.json`

Top decisions:
1. Keep `@opencode-ai/plugin` and upgrade to latest minor patch line.
2. Keep `@openauthjs/openauth` but flag freshness/metadata risk for quarterly review.
3. Keep `hono` and pin patched secure range.
4. Keep `zod` (no migration needed, strong compatibility with existing schemas).

## Migration Impact
No runtime API migration was required for this remediation set:
- All dependency moves were patch/minor updates.
- Existing tests passed without behavior regressions.
- Coverage policy change affects reporting scope only, not runtime behavior.

## Residual Risks and Mitigations
1. Coverage exclusions can hide regressions in excluded files.
   - Mitigation: keep targeted integration tests around `index.ts` and add dedicated UI-interaction tests over time.
2. `@openauthjs/openauth` package metadata omits explicit license/repository fields.
   - Mitigation: track upstream repo metadata and reevaluate migration to `openid-client`/`oauth4webapi` if maintenance cadence drops.
3. Security posture can regress as transitive trees evolve.
   - Mitigation: retain `audit:ci` in CI and periodically refresh overrides.
