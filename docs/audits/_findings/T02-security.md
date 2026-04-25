---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T02 security
generated: 2026-04-25T12:45:33+08:00
---

# T02 Security

Current security-relevant state:

- OAuth callback contract remains fixed to port 1455.
- Account removal requires `confirm=true`.
- Export overwrite requires explicit `force=true`.
- Import defaults preserve a pre-import backup unless explicitly disabled.
- Optional keychain support lives under `lib/storage/keychain.ts`.

No Critical credential-exposure finding was introduced by this cleanup.

Residual note: JSON storage is the default backend; users may opt into native keychain storage via `CODEX_KEYCHAIN=1` for enhanced local security. That is expected product behavior, not a current audit blocker.
