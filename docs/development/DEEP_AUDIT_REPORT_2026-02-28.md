# Deep Comprehensive Audit Report (2026-02-28)

## Scope
Full repository deep audit focused on high-impact risk classes:
- Dependency and supply-chain vulnerabilities.
- OAuth callback security boundaries.
- Local OAuth callback server hardening and reliability behavior.

## Branch and Baseline
- Branch: `audit/deep-comprehensive-20260228-111117`
- Base: `origin/main` (`ab970af` at branch creation)

## Findings and Actions

### Phase 1: Dependency vulnerability remediation
**Risk class:** High severity supply-chain vulnerabilities reported by `npm audit`.

**Baseline findings:**
- High: `hono` (GHSA-xh87-mx6m-69f3)
- High: `minimatch` (GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74)
- High: `rollup` (GHSA-mw96-cpmx-2vgc)
- Moderate: `ajv` (GHSA-2g4f-4pwh-qvx6)

**Remediation:**
- Updated override and dependency floors:
  - `hono`: `^4.12.3`
  - `rollup`: `^4.59.0`
  - `minimatch`: `^10.2.4`
  - `@typescript-eslint/typescript-estree` nested `minimatch`: `^9.0.9`

**Outcome:**
- Initial pass cleared all high/critical findings.
- Follow-up tooling update (`npm update eslint`) removed the remaining moderate `ajv` advisory.
- Final audit status: `npm audit` reports 0 vulnerabilities.

### Phase 2: Manual OAuth callback trust hardening
**Risk class:** Callback URL trust boundary and OAuth state handling hardening.

**Remediation:**
- Added manual callback URL validation in `index.ts` for manual paste flow:
  - Protocol must be `http`.
  - Host must be `localhost` or `127.0.0.1`.
  - Port must be `1455`.
  - Path must be `/auth/callback`.
- Validation is applied in both `validate` and `callback` paths.
- Removed sensitive full OAuth URL logging with query parameters; replaced with non-sensitive auth endpoint logging.

**Tests added/updated:**
- `test/index.test.ts`:
  - Reject non-localhost host in manual callback URL.
  - Reject unexpected protocol in manual callback URL.

### Phase 3: Local OAuth server behavior hardening
**Risk class:** Local callback endpoint attack surface and callback handling reliability.

**Remediation:**
- `lib/auth/server.ts`:
  - Enforced `GET`-only callback handling (returns `405` + `Allow: GET` for others).
  - Added no-cache controls (`Cache-Control: no-store`, `Pragma: no-cache`).
  - Implemented one-time captured-code consumption semantics in `waitForCode`.

**Tests added/updated:**
- `test/server.unit.test.ts`:
  - Reject non-GET methods.
  - Assert cache-control headers on success.
  - Assert captured authorization code is consumed once.

## Deferred/Residual Items
- No remaining vulnerabilities from `npm audit` at time of verification.
- Medium/low style and refactor-only opportunities remain out of scope for this security-focused pass.

## Verification Evidence
Commands executed after remediation:
- `npm run lint` -> pass
- `npm run typecheck` -> pass
- `npm test` -> pass
- `npx vitest run test/server.unit.test.ts test/index.test.ts` -> pass
- `npm run audit:all` -> pass
- `npm audit` -> pass (0 vulnerabilities)

## Atomic Commit Map
1. `fix(audit phase 1): remediate high dependency vulnerabilities`
2. `fix(audit phase 2): harden manual OAuth callback validation`
3. `fix(audit phase 3): tighten local OAuth callback server behavior`
4. `docs(audit): publish overlap ledger and deep audit report`
5. `chore(audit): refresh eslint toolchain to clear residual moderate advisory`
