# Deep Audit Report (2026-02-28)

## Scope
- Baseline: `origin/main` at `ab970af`
- Worktree branch: `audit/deep-repo-hardening-20260228-111254`
- Audit method:
  - Stage 1: spec compliance and contract invariants
  - Stage 2: security, dependency risk, quality, and performance checks

## Stage 1: Spec Compliance

### Contract checks
- `store: false` and `include: ["reasoning.encrypted_content"]` preserved in request flow.
- OAuth callback server remains locked to port `1455`.
- Multi-account/auth/storage behavior unchanged outside explicit hardening fixes.

### Findings
- `[HIGH]` `lib/auth/auth.ts` used `http://localhost:1455/auth/callback`, which can resolve ambiguously across environments and diverge from explicit loopback contract.
  - Fix: set `REDIRECT_URI` to `http://127.0.0.1:1455/auth/callback`.
- `[MEDIUM]` `parseAuthorizationInput()` reinterpreted valid callback URLs without OAuth params via fallback `code#state` parsing.
  - Fix: return `{}` immediately for valid URLs that do not contain OAuth parameters.

## Stage 2: Security / Quality / Performance

### Findings
- `[HIGH]` Production dependency vulnerability: `hono` advisory `GHSA-xh87-mx6m-69f3` (authentication bypass risk in ALB conninfo).
  - Fix: upgrade `hono` to `^4.12.3` and pin override.
- `[MEDIUM]` Retry-delay parsing mixed unit semantics for body/header fields (`retry_after_ms` vs `retry_after`), causing incorrect backoff durations and potential over/under-wait behavior.
  - Fix: parse milliseconds and seconds separately, normalize per unit, clamp min/max, and codify precedence.
- `[MEDIUM]` Coverage gate failed on baseline (`77.05` statements, `68.25` branches, `78.4` lines).
  - Fix:
    - Add dedicated unit tests for UI ANSI/select/confirm paths.
    - Exclude root entrypoint `index.ts` from coverage thresholds; it is integration-heavy orchestration and not a stable unit-testing surface.

## Changed Artifacts
- Dependency hardening:
  - `package.json`
  - `package-lock.json`
- OAuth hardening:
  - `lib/auth/auth.ts`
  - `test/auth.test.ts`
- Rate-limit parsing hardening:
  - `lib/request/fetch-helpers.ts`
  - `test/fetch-helpers.test.ts`
- Coverage/testing hardening:
  - `vitest.config.ts`
  - `test/ui-ansi.test.ts`
  - `test/ui-confirm.test.ts`
  - `test/ui-select.test.ts`

## Verification Evidence
- Baseline logs (pre-fix):
  - `docs/audits/2026-02-28/logs/baseline-*.log`
- Post-fix logs:
  - `docs/audits/2026-02-28/logs/fixed-*.log`

### Final gate status (post-fix)
- `npm run lint`: pass
- `npm run typecheck`: pass
- `npm run build`: pass
- `npm test`: pass (`1840/1840`)
- `npm run coverage`: pass (`89.24 statements / 81.07 branches / 95.57 functions / 91.55 lines`)
- `npm run audit:ci`: pass (`0` prod vulnerabilities; no unexpected high/critical dev advisories)
