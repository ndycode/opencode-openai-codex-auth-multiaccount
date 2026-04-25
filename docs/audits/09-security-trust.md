> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: security and trust

# Security And Trust

Current posture:

- OAuth remains PKCE-based and uses the fixed local callback on port 1455.
- No public security issue should be opened for sensitive findings; follow `SECURITY.md`.
- Account storage supports optional native keychain handling through `lib/storage/keychain.ts`.
- JSON storage and imports route through focused storage modules.
- Destructive account removal requires `confirm=true`.
- Export overwrite requires explicit `force=true`.

Residual trust notes:

- JSON storage is the default backend; native keychain storage is an explicit opt-in via `CODEX_KEYCHAIN=1`.
- Request body logging remains explicitly opt-in and can contain sensitive payloads.
- Keep docs and examples clear that `store: false` plus `reasoning.encrypted_content` is required for stateless continuity.
