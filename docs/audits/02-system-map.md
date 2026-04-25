> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: system map

# System Map

```text
OpenCode
  -> index.ts
     -> auth.loader and fetch pipeline
     -> ToolContext construction
     -> createToolRegistry(ctx)
        -> 21 lib/tools/codex-*.ts modules
  -> lib/request/*
     -> URL rewrite, body transform, headers, retry classification, SSE handling
  -> lib/accounts.ts
     -> accounts/state.ts, persistence.ts, rotation.ts, recovery.ts, rate-limits.ts
  -> lib/storage.ts
     -> storage/load-save.ts, export-import.ts, keychain.ts, flagged.ts, paths.ts
  -> ChatGPT Codex backend
```

Key current anchors:

- Tool registry: `lib/tools/index.ts`.
- Registry attachment: `index.ts` builds `ToolContext` and exposes `tool: createToolRegistry(ctx)`.
- Stateless request contract: `lib/request/request-transformer.ts` forces `store: false` and includes `reasoning.encrypted_content`.
- OAuth callback: `lib/oauth-constants.ts` and `lib/auth/server.ts` keep port 1455.
- Storage facade: `lib/storage.ts` preserves public imports while focused modules own implementation.

Documentation map:

```text
docs/
  index.md, README.md, DOCUMENTATION.md
  getting-started.md, configuration.md, troubleshooting.md, faq.md, privacy.md
  OPENCODE_PR_PROPOSAL.md, _config.yml
  development/
    ARCHITECTURE.md, CONFIG_FIELDS.md, CONFIG_FLOW.md, TESTING.md, TUI_PARITY_CHECKLIST.md
  audits/
    INDEX.md, 01-executive-summary.md ... 16-verdict.md
    _findings/T01-architecture.md ... T16-code-health.md
    _meta/AUDIT-RUBRIC.md, findings-ledger.csv, sha.lock, verification-report.md, and audit support files
```

Doc/code alignment rule: source architecture claims belong in `docs/development/ARCHITECTURE.md`; current audit claims belong in `docs/audits/`; public setup and runtime behavior belong in `docs/getting-started.md`, `docs/configuration.md`, and `docs/troubleshooting.md`.
