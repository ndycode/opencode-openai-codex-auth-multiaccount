> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00

# Oracle Review

Manual source checks performed:

| Check | Evidence | Result |
| --- | --- | --- |
| Tool registry count | `lib/tools/index.ts` plus `lib/tools/codex-*.ts` | 21 registered tools |
| Export default | `lib/tools/codex-export.ts` | passes `force ?? false` |
| Help topic behavior | `lib/tools/codex-help.ts` | exact key match |
| Remove confirmation | `lib/tools/codex-remove.ts` | requires `confirm=true` |
| Minimal config | `config/minimal-opencode.json` | includes stateless continuity field |
| Audit stale anchors | `test/doc-parity.test.ts` | blocked by test |
