---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T04 request pipeline
generated: 2026-04-25T12:45:33+08:00
---

# T04 Request Pipeline

Current contract:

- `transformRequestBody` forces `store: false`.
- `transformRequestBody` forces `stream: true` so callers can rely on the SSE response path.
- `reasoning.encrypted_content` is preserved in `include`.
- URL/header/error mapping lives in `lib/request/fetch-helpers.ts`.
- SSE handling lives in `lib/request/response-handler.ts`.

Current medium findings:

- `request-transformer.ts` is 1186 lines and owns several transform subdomains.
- `fetch-helpers.ts` is 1104 lines and combines retry, auth, rewrite, and error-classification concerns.

Recommendation: avoid broad rewrites. Extract only when a focused failing test requires it.
