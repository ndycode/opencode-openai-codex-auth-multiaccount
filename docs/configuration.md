# configuration

complete reference for configuring the plugin. most of this is optional - defaults work fine for most people.

---

## quick start

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["oc-chatgpt-multi-auth@latest"],
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "reasoningSummary": "auto",
        "textVerbosity": "medium",
        "include": ["reasoning.encrypted_content"],
        "store": false
      }
    }
  }
}
```

---

## model options

### reasoningEffort

controls how much thinking the model does.

| model | supported values |
|-------|------------------|
| `gpt-5.2` | none, low, medium, high, xhigh |
| `gpt-5-codex` | low, medium, high (default: high) |
| `gpt-5.3-codex` | low, medium, high, xhigh |
| `gpt-5.3-codex-spark` | low, medium, high, xhigh (entitlement-gated; add manually) |
| `gpt-5.2-codex` | low, medium, high, xhigh |
| `gpt-5.1-codex-max` | low, medium, high, xhigh |
| `gpt-5.1-codex` | low, medium, high |
| `gpt-5.1-codex-mini` | medium, high |
| `gpt-5.1` | none, low, medium, high |

the shipped config templates include 21 presets and do not add Spark by default. add `gpt-5.3-codex-spark` manually only for entitled workspaces.

what they mean:
- `none` - no reasoning phase (base models only, auto-converts to `low` for codex)
- `low` - light reasoning, fastest
- `medium` - balanced (default)
- `high` - deep reasoning
- `xhigh` - max depth for complex tasks (default for `gpt-5.3-codex`, `gpt-5.2-codex`, and `gpt-5.1-codex-max`)

### reasoningSummary

| value | what it does |
|-------|--------------|
| `auto` | adapts automatically (default) |
| `concise` | short summaries |
| `detailed` | verbose summaries |

legacy `off`/`on` values are accepted from old configs but normalized to `auto` at request time.

### textVerbosity

| value | what it does |
|-------|--------------|
| `low` | concise responses |
| `medium` | balanced (default) |
| `high` | verbose responses |

### include

array of extra response fields.

| value | why you need it |
|-------|-----------------|
| `reasoning.encrypted_content` | required for multi-turn with `store: false` |

### store

| value | what it does |
|-------|--------------|
| `false` | stateless mode (required for this plugin) |
| `true` | not supported by codex api |

---

## plugin config

advanced settings go in `~/.opencode/openai-codex-auth-config.json`:

```json
{
  "requestTransformMode": "native",
  "codexMode": true,
  "hashlineBridgeHintsMode": "auto",
  "hashlineBridgeHintsBeta": false,
  "codexTuiV2": true,
  "codexTuiColorProfile": "truecolor",
  "codexTuiGlyphMode": "ascii",
  "fastSession": false,
  "fastSessionStrategy": "hybrid",
  "fastSessionMaxInputItems": 30,
  "perProjectAccounts": true,
  "toastDurationMs": 5000,
  "retryAllAccountsRateLimited": true,
  "retryAllAccountsMaxWaitMs": 0,
  "toolArgumentRecoveryMode": "safe",
  "retryPolicyMode": "legacy",
  "rerouteNoticeMode": "log",
  "jsonRepairMode": "safe",
  "configDoctorMode": "warn",
  "unsupportedCodexPolicy": "strict",
  "fallbackOnUnsupportedCodexModel": false,
  "fallbackToGpt52OnUnsupportedGpt53": true,
  "unsupportedCodexFallbackChain": {
    "gpt-5-codex": ["gpt-5.2-codex"]
  }
}
```

### options

| option | default | what it does |
|--------|---------|--------------|
| `requestTransformMode` | `native` | request shaping mode: `native` keeps OpenCode payloads unchanged; `legacy` enables Codex compatibility rewrites |
| `policyProfile` | `stable` | bundled defaults for advanced toggles: `stable`, `balanced`, `aggressive` (explicit per-setting values still win) |
| `codexMode` | `true` | legacy-only bridge prompt behavior (applies when `requestTransformMode=legacy`) |
| `hashlineBridgeHintsMode` | `auto` | hashline guidance in `legacy` mode: `auto` (enable hints only when runtime exposes hashline tools), `off`, `hints`, `strict` |
| `hashlineBridgeHintsBeta` | `false` | legacy boolean compatibility used only when `hashlineBridgeHintsMode` is unset (`true -> hints`, `false -> off`) |
| `codexTuiV2` | `true` | enables codex-style terminal ui output (set `false` to keep legacy output) |
| `codexTuiColorProfile` | `truecolor` | terminal color profile for codex ui (`truecolor`, `ansi256`, `ansi16`) |
| `codexTuiGlyphMode` | `ascii` | glyph set for codex ui (`ascii`, `unicode`, `auto`) |
| `fastSession` | `false` | forces low-latency settings per request (`reasoningEffort=none/low`, `reasoningSummary=auto`, `textVerbosity=low`) |
| `fastSessionStrategy` | `hybrid` | `hybrid` speeds simple turns and keeps full-depth for complex prompts; `always` forces fast mode every turn |
| `fastSessionMaxInputItems` | `30` | max input items kept when fast mode is applied |
| `accountScopeMode` | `project` | account storage scope: `global`, `project`, or `worktree` |
| `perProjectAccounts` | `true` | legacy boolean compatibility for `accountScopeMode` (`true -> project`, `false -> global`) |
| `toastDurationMs` | `5000` | how long toast notifications stay visible (ms) |
| `retryAllAccountsRateLimited` | `true` | wait and retry when all accounts hit rate limits |
| `retryAllAccountsMaxWaitMs` | `0` | max wait time in ms (0 = unlimited) |
| `retryAllAccountsMaxRetries` | `Infinity` | max retry attempts (omit this key for unlimited retries) |
| `toolArgumentRecoveryMode` | `safe` | one-time retry guidance for known-safe tool argument schema failures (for example missing `run_in_background`); set `off` to disable |
| `retryPolicyMode` | `legacy` | retry orchestration mode: `legacy` (current behavior) or `route-matrix` (route-aware policy engine, opt-in) |
| `rerouteNoticeMode` | `log` | reroute visibility: `off`, `log` (warn log only), or `log+ui` (warn log + TUI toast) |
| `jsonRepairMode` | `safe` | safe SSE JSON repair for malformed `data:` payloads during non-stream conversion; `off` disables repair |
| `configDoctorMode` | `warn` | startup config warnings for conflicting/legacy settings; `off` disables doctor warnings |
| `unsupportedCodexPolicy` | `strict` | unsupported-model behavior: `strict` (return entitlement error) or `fallback` (retry with configured fallback chain) |
| `fallbackOnUnsupportedCodexModel` | `false` | legacy fallback toggle mapped to `unsupportedCodexPolicy` (prefer using `unsupportedCodexPolicy`) |
| `fallbackToGpt52OnUnsupportedGpt53` | `true` | legacy compatibility toggle for the `gpt-5.3-codex -> gpt-5.2-codex` edge when generic fallback is enabled |
| `unsupportedCodexFallbackChain` | `{}` | optional per-model fallback-chain override (map of `model -> [fallback1, fallback2, ...]`) |
| `sessionRecovery` | `true` | auto-recover from common api errors |
| `autoResume` | `true` | auto-resume after thinking block recovery |
| `tokenRefreshSkewMs` | `60000` | refresh tokens this many ms before expiry |
| `tokenRefreshSkewMode` | `static` | token-refresh window mode: `static` uses `tokenRefreshSkewMs`, `adaptive` scales skew from expiry horizon + recent refresh failures |
| `rateLimitToastDebounceMs` | `60000` | debounce rate limit toasts |
| `fetchTimeoutMs` | `60000` | upstream fetch timeout in ms |
| `streamStallTimeoutMs` | `45000` | max time to wait for next SSE chunk before aborting |

`hashlineBridgeHintsMode` details:
- `auto`: default. detect runtime tool names and enable hashline hints only when hashline-style edit tools are exposed.
- `auto` also uses runtime tool metadata signals (description/schema) for runtimes that expose hashline behavior behind generic names like `edit`.
- `off`: disable hashline-specific guidance.
- `hints`: add soft preference guidance for hashline tools.
- `strict`: add hashline-first policy guidance for targeted edits.

note: true hashline execution still depends on runtime tool availability. if the runtime manifest only includes generic tools (for example `apply_patch` and no hashline-style tool names), the plugin cannot force hashline execution.

### tool argument recovery

`toolArgumentRecoveryMode` controls safe retries for tool-call argument schema mismatches.

- `safe` (default): detect known-safe missing required arguments (currently includes `run_in_background`), inject corrective guidance, and retry once before account rotation.
- `off`: disable this recovery path and surface the original error immediately.
- `schema-safe`: uses runtime tool schema metadata (when available) to enrich safe recovery guidance while keeping the same one-retry cap.

approval/policy errors (sandbox/approval denials) are classified separately and do not trigger account rotation.

### reroute notices + JSON repair

- `rerouteNoticeMode: "log"` (default) logs `Model reroute observed` when upstream serves a different effective model than requested.
- `rerouteNoticeMode: "log+ui"` also shows a TUI warning toast (deduped per reroute pair).
- `jsonRepairMode: "safe"` applies bounded repair (for example code fences / trailing commas) when parsing malformed SSE `data:` JSON payloads during non-stream conversion.
- `codex-metrics` now reports edit-path telemetry (`hashline-like` / `patch` / `edit` strategy attempts, success rate, average latency, and failure-route counts).

### config doctor

`configDoctorMode: "warn"` (default) logs non-blocking startup warnings for conflicting legacy/modern plugin settings and common config footguns.

### policy profiles + account scope

- `policyProfile: "stable"` keeps conservative defaults (`retryPolicyMode=legacy`, `accountScopeMode=project`, `tokenRefreshSkewMode=static`).
- `policyProfile: "balanced"` enables stronger operational defaults (`retryPolicyMode=route-matrix`, `rerouteNoticeMode=log+ui`, `tokenRefreshSkewMode=adaptive`).
- `policyProfile: "aggressive"` enables strict hashline guidance + schema-safe tool recovery + worktree account isolation defaults.
- explicit setting keys always override profile defaults.

### unsupported-model behavior + fallback chain

by default the plugin is strict (`unsupportedCodexPolicy: "strict"`). it returns entitlement errors directly for unsupported models.

set `unsupportedCodexPolicy: "fallback"` to enable model fallback after account/workspace attempts are exhausted.

defaults when fallback policy is enabled and `unsupportedCodexFallbackChain` is empty:
- `gpt-5.3-codex -> gpt-5-codex -> gpt-5.2-codex`
- `gpt-5.3-codex-spark -> gpt-5-codex -> gpt-5.3-codex -> gpt-5.2-codex` (applies if you manually select Spark model IDs)
- `gpt-5.2-codex -> gpt-5-codex`
- `gpt-5.1-codex -> gpt-5-codex`

note: the TUI can continue showing your originally selected model while fallback is applied internally. use request logs to verify the effective upstream model (`request-*-after-transform.json`). set `CODEX_PLUGIN_LOG_BODIES=1` when you need to inspect raw `.body.*` fields.

custom chain example:
```json
{
  "unsupportedCodexPolicy": "fallback",
  "fallbackOnUnsupportedCodexModel": true,
  "unsupportedCodexFallbackChain": {
    "gpt-5-codex": ["gpt-5.2-codex"],
    "gpt-5.3-codex": ["gpt-5-codex", "gpt-5.2-codex"],
    "gpt-5.3-codex-spark": ["gpt-5-codex", "gpt-5.3-codex", "gpt-5.2-codex"]
  }
}
```

legacy toggle compatibility:
- `CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL=1` maps to fallback mode
- `CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL=0` maps to strict mode

### environment variables

override any config with env vars:

| variable | what it does |
|----------|--------------|
| `DEBUG_CODEX_PLUGIN=1` | enable debug logging |
| `ENABLE_PLUGIN_REQUEST_LOGGING=1` | log request metadata (no raw prompt/response bodies) |
| `CODEX_PLUGIN_LOG_BODIES=1` | include raw request/response bodies in log files (sensitive) |
| `CODEX_PLUGIN_LOG_LEVEL=debug` | set log level (debug/info/warn/error) |
| `CODEX_AUTH_REQUEST_TRANSFORM_MODE=legacy` | re-enable legacy Codex request rewriting |
| `CODEX_MODE=0` | disable bridge prompt |
| `CODEX_AUTH_POLICY_PROFILE=balanced` | set bundled defaults profile (`stable`, `balanced`, `aggressive`) |
| `CODEX_AUTH_HASHLINE_HINTS_MODE=auto` | set hashline guidance mode (`auto`, `off`, `hints`, `strict`) |
| `CODEX_AUTH_HASHLINE_HINTS_BETA=1` | legacy toggle used only when `CODEX_AUTH_HASHLINE_HINTS_MODE` is unset |
| `CODEX_TUI_V2=0` | disable codex-style ui (use legacy output) |
| `CODEX_TUI_COLOR_PROFILE=ansi16` | force color profile for codex ui |
| `CODEX_TUI_GLYPHS=unicode` | override glyph mode (`ascii`, `unicode`, `auto`) |
| `CODEX_AUTH_PREWARM=0` | disable startup prewarm (prompt/instruction cache warmup) |
| `CODEX_AUTH_FAST_SESSION=1` | enable fast-session defaults |
| `CODEX_AUTH_FAST_SESSION_STRATEGY=always` | force fast mode on every prompt |
| `CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS=24` | tune max retained input items in fast mode |
| `CODEX_AUTH_ACCOUNT_SCOPE_MODE=worktree` | explicit account storage scope (`global`, `project`, `worktree`) |
| `CODEX_AUTH_PER_PROJECT_ACCOUNTS=0` | disable per-project accounts |
| `CODEX_AUTH_TOAST_DURATION_MS=8000` | set toast duration |
| `CODEX_AUTH_RETRY_ALL_RATE_LIMITED=0` | disable wait-and-retry |
| `CODEX_AUTH_RETRY_ALL_MAX_WAIT_MS=30000` | set max wait time |
| `CODEX_AUTH_RETRY_ALL_MAX_RETRIES=1` | set max retries |
| `CODEX_AUTH_TOOL_ARGUMENT_RECOVERY_MODE=safe` | override safe tool argument recovery (`safe` or `off`) |
| `CODEX_AUTH_RETRY_POLICY_MODE=route-matrix` | opt in to route-aware retry policy matrix |
| `CODEX_AUTH_REROUTE_NOTICE_MODE=log+ui` | show reroute warnings in logs and TUI (`off`, `log`, `log+ui`) |
| `CODEX_AUTH_JSON_REPAIR_MODE=safe` | enable/disable safe SSE JSON repair (`safe`, `off`) |
| `CODEX_AUTH_CONFIG_DOCTOR_MODE=warn` | enable/disable startup config doctor warnings (`warn`, `off`) |
| `CODEX_AUTH_TOKEN_REFRESH_SKEW_MODE=adaptive` | choose token refresh skew policy (`static`, `adaptive`) |
| `CODEX_AUTH_UNSUPPORTED_MODEL_POLICY=fallback` | enable generic unsupported-model fallback policy |
| `CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL=1` | legacy fallback toggle (prefer policy variable above) |
| `CODEX_AUTH_FALLBACK_GPT53_TO_GPT52=0` | disable only the legacy `gpt-5.3-codex -> gpt-5.2-codex` edge |
| `CODEX_AUTH_ACCOUNT_ID=acc_xxx` | force specific workspace id |
| `CODEX_AUTH_FETCH_TIMEOUT_MS=120000` | override fetch timeout |
| `CODEX_AUTH_STREAM_STALL_TIMEOUT_MS=60000` | override SSE stall timeout |

---

## config patterns

### global options

same settings for all models:

```json
{
  "plugin": ["oc-chatgpt-multi-auth@latest"],
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "high",
        "textVerbosity": "high",
        "store": false
      }
    }
  }
}
```

### per-model options

different settings for different models:

```json
{
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "store": false
      },
      "models": {
        "gpt-5.2-fast": {
          "name": "fast gpt-5.2",
          "options": { "reasoningEffort": "low" }
        },
        "gpt-5.2-smart": {
          "name": "smart gpt-5.2",
          "options": { "reasoningEffort": "high" }
        }
      }
    }
  }
}
```

model options override global options.

### project-specific

global (`~/.config/opencode/opencode.json`):
```json
{
  "plugin": ["oc-chatgpt-multi-auth@latest"],
  "provider": {
    "openai": {
      "options": { "reasoningEffort": "medium" }
    }
  }
}
```

project (`my-project/.opencode.json`):
```json
{
  "provider": {
    "openai": {
      "options": { "reasoningEffort": "high" }
    }
  }
}
```

result: project uses `high`, other projects use `medium`.

---

## file locations

| file | what it's for |
|------|---------------|
| `~/.config/opencode/opencode.json` | global opencode config |
| `<project>/.opencode.json` | project-specific config |
| `~/.opencode/openai-codex-auth-config.json` | plugin config |
| `~/.opencode/auth/openai.json` | oauth tokens |
| `~/.opencode/openai-codex-accounts.json` | global account storage |
| `~/.opencode/projects/<project-key>/openai-codex-accounts.json` | per-project account storage |
| `~/.opencode/logs/codex-plugin/` | debug logs |

---

## debugging

### check config is valid

```bash
opencode
# shows errors if config is invalid
```

### verify model resolution

```bash
DEBUG_CODEX_PLUGIN=1 opencode run "test" --model=openai/gpt-5.2
```

look for:
```
[openai-codex-plugin] Model config lookup: "gpt-5.2" → normalized to "gpt-5.2" for API {
  hasModelSpecificConfig: true,
  resolvedConfig: { ... }
}
```

### test per-model options

```bash
# modern opencode (variants)
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5.2 --variant=low
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5.2 --variant=high

# legacy presets (model names include the effort)
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5.2-low
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5.2-high

# compare reasoning.effort in logs
cat ~/.opencode/logs/codex-plugin/request-*-after-transform.json | jq '.reasoning.effort'
```

---

## troubleshooting

### model not found

**error**: `Model 'openai/my-model' not found`

**fix**: make sure config key matches exactly:
```json
{ "models": { "my-model": { ... } } }
```
```bash
opencode run "test" --model=openai/my-model
```

### per-model options not applied

```bash
DEBUG_CODEX_PLUGIN=1 opencode run "test" --model=openai/your-model
```

look for `hasModelSpecificConfig: true`. if it's false, config lookup failed - check for typos.

### per-project accounts not working

make sure you're in a project directory (has `.git`, `package.json`, etc). the plugin auto-detects the project root and uses a namespaced file under `~/.opencode/projects/`. if no project root is found, it falls back to global storage.

check which storage is being used:
```bash
DEBUG_CODEX_PLUGIN=1 opencode
# look for storage path in logs
```

### approval or policy errors

if a tool call is blocked by approval/sandbox policy, the plugin now returns the policy message directly and does not rotate accounts.

### model reroute observability

when upstream responds with a different effective model than the requested model, the plugin emits a warning log:

```text
Model reroute observed
```

enable debug/request logging if you want to correlate this with the request body and selected model.

---

**next**: [troubleshooting](troubleshooting.md) | [back to docs](index.md)
