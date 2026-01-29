# PROJECT KNOWLEDGE BASE

Generated: 2026-01-29
Commit: 693b0cc
Branch: main

## OVERVIEW
OpenCode plugin that swaps OpenAI SDK calls to the ChatGPT Codex backend with multi-account OAuth.

## STRUCTURE
```
./
├── index.ts                  # plugin entry point (not under src/)
├── lib/                       # main source (auth, request, prompts, config)
├── test/                      # vitest suites
├── scripts/                   # install + build helpers
├── assets/                    # static assets
├── config/                    # OpenCode config examples
├── docs/                      # architecture docs/diagrams
├── dist/                      # build output (generated)
└── SECURITY.md                # vuln reporting rules
```

## WHERE TO LOOK
| Task | Location | Notes |
| --- | --- | --- |
| Fetch flow orchestration | `index.ts` | 7-step request pipeline
| OAuth flow + tokens | `lib/auth/auth.ts` | PKCE, refresh, JWT decode
| OAuth callback server | `lib/auth/server.ts` | binds port 1455
| Request mutation | `lib/request/request-transformer.ts` | model normalization + prompts
| Request helpers | `lib/request/fetch-helpers.ts` | headers, rate limit handling
| SSE response handling | `lib/request/response-handler.ts` | SSE to JSON
| Prompt fetching/cache | `lib/prompts/codex.ts` | GitHub release ETag cache
| Config parsing | `lib/config.ts` | CODEX_MODE + options
| Tests | `test/` | vitest globals enabled

## CONVENTIONS
- Source lives in `index.ts` and `lib/`; `dist/` is generated.
- ESLint flat config: no `any`, unused args must be prefixed with `_`.
- Test files relax lint rules; see `eslint.config.js`.
- Build must copy `lib/oauth-success.html` into `dist/lib/` (see `scripts/copy-oauth-success.js`).

## ANTI-PATTERNS (THIS PROJECT)
- Do not edit `dist/` outputs or `tmp*` directories.
- Do not open public security issues; follow `SECURITY.md` for reporting.

## COMMANDS
```bash
npm run build
npm run typecheck
npm test
npm run lint
```

## NOTES
- OAuth callback server binds `http://127.0.0.1:1455/auth/callback`.
- ChatGPT backend requires stateless requests (`store: false`, include encrypted reasoning).
