# Deep Audit Overlap Ledger (2026-02-28)

## Purpose
Track overlap against currently open audit PRs so this branch remains incremental and avoids duplicate fixes where possible.

## Open Audit PRs Reviewed
- #44 `audit/architect-deep-audit-2026-02-28` -> `main`
- #45 `audit/phase-1-deps-security-20260228` -> `main`
- #46 `audit/phase-2-oauth-hardening-20260228` -> `audit/phase-1-deps-security-20260228`
- #47 `audit/phase-3-rate-limit-units-20260228` -> `audit/phase-2-oauth-hardening-20260228`
- #48 `audit/full-code-quality-main-20260228` -> `main`

## Overlap Assessment

### Dependency hardening overlap
- Potential overlap area: #45 and #48 both touch dependency remediation.
- This branch kept dependency work scoped to currently reproducible high vulnerabilities from `npm audit` on `main`.
- Effective changes here:
  - `hono` floor raised to `^4.12.3`
  - `rollup` floor raised to `^4.59.0`
  - `minimatch` floors raised to `^10.2.4` and `^9.0.9` for `@typescript-eslint/typescript-estree`
- Result: high vulnerabilities cleared in this branch; only one moderate `ajv` advisory remains in dev tooling (`eslint` transitive path).

### Auth/server overlap
- PR #44/#46 touch auth-related files including `index.ts` and `lib/auth/server.ts`.
- This branch intentionally targets distinct controls not represented in those PR descriptions:
  - Manual OAuth callback URL trust boundary validation (protocol/host/port/path enforcement).
  - Removal of sensitive OAuth URL query logging (state/challenge leak reduction).
  - Local callback server hardening: method allowlist (`GET` only), no-store headers, one-time code consumption semantics.

### Rate-limit overlap
- PR #47 focuses retry-after unit parsing in `lib/request/fetch-helpers.ts`.
- This branch does not modify retry-after parsing logic and therefore does not duplicate that unit-conversion patchline.

## Exclusions in This Branch
- No medium/low-only cleanup work.
- No refactor-only churn.
- No duplication of chained phase-branch mechanics used by PR #45 -> #46 -> #47.

## Verification Snapshot
- Baseline before fixes: `npm audit --audit-level=high` reported 3 high + 1 moderate.
- After phase 1 dependency remediation: `npm audit --audit-level=high` reports 0 high/critical, 1 moderate.
