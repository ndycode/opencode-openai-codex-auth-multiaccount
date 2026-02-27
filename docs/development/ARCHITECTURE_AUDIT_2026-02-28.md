# Architecture + Security Audit (2026-02-28)

## Scope

- Full repository audit across auth, request pipeline, account rotation, storage, and dependency supply chain.
- Severity focus: Critical, High, Medium.
- Remediation PR policy: fix-in-place for findings above threshold.

## Findings and Remediations

### 1) Dependency Vulnerabilities (High/Moderate)

- Baseline `npm audit` reported 4 vulnerabilities (3 high, 1 moderate), including direct `hono` exposure plus transitive `rollup`, `minimatch`, and `ajv`.
- Remediation: ran `npm audit fix`, updated lockfile graph, and verified `npm audit` reports zero vulnerabilities.

### 2) OAuth Loopback Host Mismatch (Medium)

- OAuth redirect URI used `localhost` while callback listener binds to `127.0.0.1`.
- On environments where `localhost` resolves to non-IPv4 loopback, this can cause callback failures.
- Remediation: aligned redirect URI to `http://127.0.0.1:1455/auth/callback`.

### 3) Hybrid Selection vs Token-Bucket Eligibility Mismatch (Medium)

- Hybrid account selection and current-account fast path did not enforce token availability.
- This could pick accounts that are locally token-depleted and trigger avoidable request failure behavior.
- Remediation:
  - enforce token availability during current-account reuse and hybrid eligibility filtering;
  - continue account traversal when local token consumption fails to avoid premature loop exit.

### 4) OAuth Success-Page Single-Point Failure (Medium)

- OAuth callback server loaded `oauth-success.html` synchronously at module import with no fallback.
- If that asset was missing in a runtime package edge case, plugin startup could fail before auth flow execution.
- Remediation:
  - add resilient loader with warning telemetry;
  - serve a built-in minimal success page when file load fails.
  - enforce `waitForCode(state)` contract by checking captured callback state before returning a code.

## Verification

- `npm run lint` pass
- `npm run typecheck` pass
- `npm test` pass
- `npm audit` reports zero vulnerabilities

## Notes

- This audit focused on root-cause correctness and supply-chain risk reduction, while preserving existing plugin APIs and storage format compatibility.
