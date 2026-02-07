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
| `gpt-5.3-codex` | low, medium, high, xhigh (default: xhigh) |
| `gpt-5.2-codex` | low, medium, high, xhigh (default: xhigh) |
| `gpt-5.1-codex-max` | low, medium, high, xhigh |
| `gpt-5.1-codex` | low, medium, high |
| `gpt-5.1-codex-mini` | medium, high |
| `gpt-5.1` | none, low, medium, high |

what they mean:
- `none` - no reasoning phase (base models only, auto-converts to `low` for codex)
- `low` - light reasoning, fastest
- `medium` - balanced (default)
- `high` - deep reasoning
- `xhigh` - max depth for complex tasks (downgrades to `high` on unsupported models)

### reasoningSummary

| value | what it does |
|-------|--------------|
| `auto` | adapts automatically (default) |
| `concise` | short summaries |
| `detailed` | verbose summaries |
| `off` | disable (codex max only) |
| `on` | force enable (codex max only) |

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
  "codexMode": true,
  "fastSession": false,
  "fastSessionStrategy": "hybrid",
  "fastSessionMaxInputItems": 30,
  "perProjectAccounts": true,
  "toastDurationMs": 5000,
  "retryAllAccountsRateLimited": true,
  "retryAllAccountsMaxWaitMs": 0,
  "retryAllAccountsMaxRetries": null
}
```

### options

| option | default | what it does |
|--------|---------|--------------|
| `codexMode` | `true` | uses codex-opencode bridge prompt (synced with codex cli) |
| `fastSession` | `false` | forces low-latency settings per request (`reasoningEffort=none/low`, `reasoningSummary=off`, `textVerbosity=low`) |
| `fastSessionStrategy` | `hybrid` | `hybrid` speeds simple turns and keeps full-depth for complex prompts; `always` forces fast mode every turn |
| `fastSessionMaxInputItems` | `30` | max input items kept when fast mode is applied |
| `perProjectAccounts` | `true` | each project gets its own account storage |
| `toastDurationMs` | `5000` | how long toast notifications stay visible (ms) |
| `retryAllAccountsRateLimited` | `true` | wait and retry when all accounts hit rate limits |
| `retryAllAccountsMaxWaitMs` | `0` | max wait time in ms (0 = unlimited) |
| `retryAllAccountsMaxRetries` | `Infinity` | max retry attempts |
| `sessionRecovery` | `true` | auto-recover from common api errors |
| `autoResume` | `true` | auto-resume after thinking block recovery |
| `tokenRefreshSkewMs` | `60000` | refresh tokens this many ms before expiry |
| `rateLimitToastDebounceMs` | `60000` | debounce rate limit toasts |
| `fetchTimeoutMs` | `60000` | upstream fetch timeout in ms |
| `streamStallTimeoutMs` | `45000` | max time to wait for next SSE chunk before aborting |

### environment variables

override any config with env vars:

| variable | what it does |
|----------|--------------|
| `DEBUG_CODEX_PLUGIN=1` | enable debug logging |
| `ENABLE_PLUGIN_REQUEST_LOGGING=1` | log all api requests |
| `CODEX_PLUGIN_LOG_LEVEL=debug` | set log level (debug/info/warn/error) |
| `CODEX_MODE=0` | disable bridge prompt |
| `CODEX_AUTH_PREWARM=0` | disable startup prewarm (prompt/instruction cache warmup) |
| `CODEX_AUTH_FAST_SESSION=1` | enable fast-session defaults |
| `CODEX_AUTH_FAST_SESSION_STRATEGY=always` | force fast mode on every prompt |
| `CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS=24` | tune max retained input items in fast mode |
| `CODEX_AUTH_PER_PROJECT_ACCOUNTS=0` | disable per-project accounts |
| `CODEX_AUTH_TOAST_DURATION_MS=8000` | set toast duration |
| `CODEX_AUTH_RETRY_ALL_RATE_LIMITED=0` | disable wait-and-retry |
| `CODEX_AUTH_RETRY_ALL_MAX_WAIT_MS=30000` | set max wait time |
| `CODEX_AUTH_RETRY_ALL_MAX_RETRIES=1` | set max retries |
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

---

**next**: [troubleshooting](troubleshooting.md) | [back to docs](index.md)
