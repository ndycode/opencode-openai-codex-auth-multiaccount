# TEST KNOWLEDGE BASE

Generated: 2026-01-29

## OVERVIEW
Vitest suites for OAuth flow, request transforms, response handling, and rotation logic.

## STRUCTURE
```
test/
├── auth.test.ts
├── fetch-helpers.test.ts
├── request-transformer.test.ts
├── response-handler.test.ts
├── oauth-server.integration.test.ts
└── ...
```

## WHERE TO LOOK
| Task | Location | Notes |
| --- | --- | --- |
| OAuth flow | `test/auth.test.ts` | PKCE + JWT decoding
| Fetch helpers | `test/fetch-helpers.test.ts` | headers + errors
| Request transforms | `test/request-transformer.test.ts` | model normalization
| SSE handling | `test/response-handler.test.ts` | SSE parsing
| OAuth server | `test/oauth-server.integration.test.ts` | binds port 1455

## CONVENTIONS
- Vitest globals are enabled (`describe`, `it`, `expect`).
- Coverage thresholds: 80% across statements/branches/functions/lines.
- Lint rules are relaxed for tests (see `eslint.config.js`).

## ANTI-PATTERNS
- Avoid hardcoding ports other than 1455 for OAuth server tests.
- Do not rely on `dist/` in tests; use source files.
