# Codex Release Parity Matrix (Semantic, Stable Non-Beta)

Generated: 2026-02-22T20:11:29.933Z

## Scope

- Source: `openai/codex` release note bodies (stable non-beta only)
- Goal: plugin-relevant semantic clustering and parity status for `oc-chatgpt-multi-auth`

## Summary

- Total release objects fetched: **528**
- Stable non-beta releases: **93**
- Releases with semantic note items: **88**
- Total semantic note items classified: **3432**

## Bucket Parity Summary

| Bucket | Status | Releases | Items | Rationale |
|---|---|---:|---:|---|
| Other / Needs Review | `planned` | 84 | 2305 | Release note item did not match current plugin-focused semantic buckets; manual review may still be needed. |
| Codex CLI / TUI | `not-applicable` | 64 | 294 | Codex CLI runtime behavior/UI internals are upstream concerns; plugin can only adapt via prompts/config and runtime signals. |
| Tools / Schemas | `partial` | 59 | 288 | Schema-safe tool-argument recovery and runtime tool capability registry are implemented; full runtime tool surface parity remains runtime-dependent. |
| Models / Capabilities | `implemented` | 59 | 228 | Dynamic model capability sync + reasoning auto-clamp are implemented in plugin. |
| Approvals / Policy | `implemented` | 46 | 161 | Approval/policy failures are classified explicitly and no longer trigger account rotation. |
| Logging / Observability | `implemented` | 28 | 77 | Structured warnings/logging added for reroute, deprecation, and failure-route diagnostics. |
| Auth / OAuth | `partial` | 31 | 54 | Plugin maintains its own OAuth flow and token handling; some Codex auth changes are upstream CLI-specific. |
| Routing / Reroute / Retry | `partial` | 19 | 25 | Reroute logging + UI notices and route-aware retry matrix exist, but matrix remains opt-in (`legacy` default). |

## Recent Semantic Releases (Newest First)

| Version | Published | Items | Top Buckets | Link |
|---|---|---:|---|---|
| `0.104.0` | 2026-02-18 | 15 | other:8, approvals_policy:3, models_capabilities:2 | https://github.com/openai/codex/releases/tag/rust-v0.104.0 |
| `0.103.0` | 2026-02-17 | 14 | other:8, cli_tui:4, models_capabilities:2 | https://github.com/openai/codex/releases/tag/rust-v0.103.0 |
| `0.102.0` | 2026-02-17 | 125 | other:73, models_capabilities:12, approvals_policy:11 | https://github.com/openai/codex/releases/tag/rust-v0.102.0 |
| `0.101.0` | 2026-02-12 | 11 | other:9, models_capabilities:2 | https://github.com/openai/codex/releases/tag/rust-v0.101.0 |
| `0.100.0` | 2026-02-12 | 101 | other:64, cli_tui:14, models_capabilities:8 | https://github.com/openai/codex/releases/tag/rust-v0.100.0 |
| `0.99.0` | 2026-02-11 | 208 | other:135, cli_tui:23, models_capabilities:16 | https://github.com/openai/codex/releases/tag/rust-v0.99.0 |
| `0.98.0` | 2026-02-05 | 16 | other:9, tools_schemas:3, models_capabilities:3 | https://github.com/openai/codex/releases/tag/rust-v0.98.0 |
| `0.97.0` | 2026-02-05 | 39 | other:22, tools_schemas:7, cli_tui:5 | https://github.com/openai/codex/releases/tag/rust-v0.97.0 |
| `0.96.0` | 2026-02-04 | 29 | other:20, cli_tui:3, tools_schemas:2 | https://github.com/openai/codex/releases/tag/rust-v0.96.0 |
| `0.95.0` | 2026-02-04 | 81 | other:50, tools_schemas:11, approvals_policy:8 | https://github.com/openai/codex/releases/tag/rust-v0.95.0 |
| `0.94.0` | 2026-02-02 | 36 | other:29, observability:3, cli_tui:2 | https://github.com/openai/codex/releases/tag/rust-v0.94.0 |
| `0.93.0` | 2026-01-31 | 149 | other:94, tools_schemas:17, cli_tui:15 | https://github.com/openai/codex/releases/tag/rust-v0.93.0 |
| `0.92.0` | 2026-01-27 | 71 | other:52, tools_schemas:10, cli_tui:6 | https://github.com/openai/codex/releases/tag/rust-v0.92.0 |
| `0.91.0` | 2026-01-25 | 2 | other:2 | https://github.com/openai/codex/releases/tag/rust-v0.91.0 |
| `0.90.0` | 2026-01-25 | 62 | other:45, tools_schemas:5, models_capabilities:5 | https://github.com/openai/codex/releases/tag/rust-v0.90.0 |

## Example Classified Items

### Other / Needs Review (`planned`)

- `0.4.0`: Support `model_reasoning_effort` and `model_reasoning_summary` when defining a profile thanks to https://github.com/openai/codex/pull/1484
- `0.5.0`: Added new config option: `model_supports_reasoning_summaries`: https://github.com/openai/codex/pull/1524
- `0.5.0`: Removed reference to `/compact` in https://github.com/openai/codex/pull/1503 because it is not supported yet: https://github.com/openai/codex/issues/1257
- `0.6.0`: Paste summarization for large pastes: https://github.com/openai/codex/pull/1549
- `0.6.0`: Experimental `codex apply` command to interact with Codex Web: https://github.com/openai/codex/pull/1528

### Codex CLI / TUI (`not-applicable`)

- `0.3.0`: Fixes an issue where non-ASCII characters were crashing the CLI: https://github.com/openai/codex/issues/1450 (huge thanks to @ryozi-tn for the fix in https://github.com/openai/codex/pull/1467)
- `0.4.0`: Add a `completion` subcommand to the CLI in https://github.com/openai/codex/pull/1491 so we can ultimately add `generate_completions_from_executable()` to our Homebrew formula: https://github.com/Homebrew/homebrew-core/blob/main/Formula/c/codex.rb
- `0.5.0`: Thanks to @reneleonhardt for helping update a number of our dependencies (we now build with Rust 1.88!): https://github.com/openai/codex/pull/1494
- `0.5.0`: Thanks to @pchuri so that when running Codex installed via `npm`, `process.platform === "android"` will run the Rust CLI: https://github.com/openai/codex/pull/1488
- `0.5.0`: Fix generated shell completions to use the name `codex` instead of `codex-cli`: https://github.com/openai/codex/pull/1496

### Tools / Schemas (`partial`)

- `0.6.0`: `id` for notifications associated with a `codex` tool call now match the request id: https://github.com/openai/codex/pull/1554
- `0.8.0`: https://github.com/openai/codex/pull/1571 fixes a longstanding issue where we failed to handle long MCP tool names gracefully (https://github.com/openai/codex/issues/1289 was the relevant GitHub issue)
- `0.9.0`: Numerous fixes to `codex mcp`.
- `0.11.0`: https://github.com/openai/codex/pull/1726 introduces an experimental planning tool
- `0.21.0`: https://github.com/openai/codex/pull/1975 add JSON schema sanitization for MCP tools to ensure compatibility with internal JsonSchema enum external contributor: Thanks @yaroslavyaroslav!

### Models / Capabilities (`implemented`)

- `0.3.0`: Makes it possible to configure custom HTTP headers when making requests to model providers: https://github.com/openai/codex/pull/1473.
- `0.4.0`: Honor the `OPENAI_BASE_URL ` environment variable for the built-in `openai` model provider: https://github.com/openai/codex/pull/1487
- `0.8.0`: As of https://github.com/openai/codex/pull/1594, we now stream the response from the model in the TUI and when using `codex exec`
- `0.15.0`: `gpt-5` is the default model!
- `0.15.0`: new `--ask-for-approval on-request` option where the model decides whether to prompt the user (which is somewhat of a balance between the existing `on-failure` and `never`) options

### Approvals / Policy (`implemented`)

- `0.3.0`: Adds support for a `--sandbox` flag and makes some breaking changes to `config.toml` around this option. See https://github.com/openai/codex/pull/1476 for details.
- `0.11.0`: https://github.com/openai/codex/pull/1705 security fix to ensure `apply_patch` is run through the sandbox for the session
- `0.15.0`: new onboarding flow that uses `--sandbox workspace-write and --ask-for-approval on-request` as the configuration when users mark a folder is trusted (recommended default when working in a Git repo)
- `0.24.0`: Simplify command approval UI (#2708)
- `0.24.0`: #2708 [feat] Simplfy command approval UI

### Logging / Observability (`implemented`)

- `0.10.0`: We now record some Git state in the `.jsonl` log due to @vishnu-oai https://github.com/openai/codex/pull/1598
- `0.28.0`: [Logging/Telemetry]
- `0.36.0`: feat: tighten preset filter, tame storage load logs, enable rollout prompt by default (#3628)
- `0.36.0`: When logging in using ChatGPT, make sure to overwrite API key (#3611)
- `0.36.0`: Log cf-ray header in client traces (#3488)

## Notes

- This artifact is generated by `npm run audit:codex:parity`.
- Classification is heuristic and plugin-focused; review `other` bucket items manually.
- `runtime-blocked` is reserved for features requiring runtime tool support (e.g., true hashline engine exposure).

