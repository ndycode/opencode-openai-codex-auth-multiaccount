> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: file-by-file

# File By File

| File | Current role | Notes |
| --- | --- | --- |
| `index.ts` | Plugin entry, context wiring, request pipeline | 3694 lines. Tool handlers are not inline. |
| `lib/tools/index.ts` | ToolContext and registry | Wires 21 `codex-*` tools. |
| `lib/tools/codex-help.ts` | Help tool | Exact topic matching. |
| `lib/tools/codex-export.ts` | Export tool | Defaults to `force=false`. |
| `lib/tools/codex-remove.ts` | Remove tool | Requires `confirm=true`. |
| `lib/storage.ts` | Public storage facade | 79 lines over focused modules. |
| `lib/storage/export-import.ts` | Import/export behavior | Safe export default and import backup default. |
| `config/minimal-opencode.json` | Minimal config example | Includes `store:false` and `reasoning.encrypted_content`. |
| `test/doc-parity.test.ts` | Drift guard | Checks config, registry, and stale audit anchors. |
| `docs/development/ARCHITECTURE.md` | Current architecture guide | Describes 21-tool layout. |
