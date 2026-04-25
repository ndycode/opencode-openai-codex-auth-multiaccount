> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: medium findings

# Medium Findings

| ID | Area | Current evidence | Recommendation |
| --- | --- | --- | --- |
| M01 | Request transform size | `lib/request/request-transformer.ts` is 1186 lines and owns model normalization, fast-session defaults, input filtering, prompt injection, and outbound body shaping. | Split only when a behavior change forces touching multiple subdomains. |
| M02 | Fetch helper size | `lib/request/fetch-helpers.ts` is 1104 lines and combines URL rewrite, auth refresh, error classification, headers, and request transformation wrappers. | Extract error classification and retry response mapping behind tests. |
| M03 | Storage implementation size | `lib/storage/load-save.ts`, `keychain.ts`, and `worktree-lock.ts` are the largest storage modules. | Keep the facade stable and split only around concrete bug fixes. |
| M04 | Coverage branch floor | `npm run test:coverage` showed broad branch coverage at 71.6% and `index.ts` branch coverage at 51.21%, below the former aspirational thresholds. | Keep the gate executable at the current baseline and raise branch floors with focused tests in later PRs. |
