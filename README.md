# openai codex auth plugin for opencode

[![npm version](https://img.shields.io/npm/v/oc-chatgpt-multi-auth.svg)](https://www.npmjs.com/package/oc-chatgpt-multi-auth)
[![npm downloads](https://img.shields.io/npm/dw/oc-chatgpt-multi-auth.svg)](https://www.npmjs.com/package/oc-chatgpt-multi-auth)
[![Tests](https://github.com/ndycode/oc-chatgpt-multi-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/ndycode/oc-chatgpt-multi-auth/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

oauth plugin for opencode that lets you use chatgpt plus/pro rate limits with models like `gpt-5.2`, `gpt-5.2-codex`, and `gpt-5.1-codex-max`.

> [!NOTE]
> **renamed from `opencode-openai-codex-auth-multi`** — if you were using the old package, update your config to use `oc-chatgpt-multi-auth` instead. the rename was necessary because opencode blocks plugins containing `opencode-openai-codex-auth` in the name.

## what you get

- **gpt-5.2, gpt-5.2 codex, gpt-5.1 codex max** and all gpt-5.x variants via chatgpt oauth
- **multi-account support** — add up to 20 chatgpt accounts, health-aware rotation with automatic failover
- **per-project accounts** — each project gets its own account storage (new in v4.10.0)
- **click-to-switch** — switch accounts directly from the opencode tui
- **strict tool validation** — automatically cleans schemas for compatibility with strict models
- **auto-update notifications** — get notified when a new version is available
- **22 model presets** — full variant system with reasoning levels (none/low/medium/high/xhigh)
- **prompt caching** — session-based caching for faster multi-turn conversations
- **usage-aware errors** — friendly messages with rate limit reset timing
- **plugin compatible** — works alongside other opencode plugins (oh-my-opencode, dcp, etc.)

---

<details open>
<summary><b>terms of service warning — read before installing</b></summary>

> [!CAUTION]
> this plugin uses openai's official oauth authentication (the same method as openai's official codex cli) for personal development use with your chatgpt plus/pro subscription.
>
> **this plugin is for personal development only:**
> - not for commercial services, api resale, or multi-user applications
> - for production use, see [openai platform api](https://platform.openai.com/)
>
> **by using this plugin, you acknowledge:**
> - this is an unofficial tool not endorsed by openai
> - users are responsible for compliance with [openai's terms of use](https://openai.com/policies/terms-of-use/)
> - you assume all risks associated with using this plugin

</details>

---

## installation

<details open>
<summary><b>for humans</b></summary>

**option a: let an llm do it**

paste this into any llm agent (claude code, opencode, cursor, etc.):

```
Install the oc-chatgpt-multi-auth plugin and add the OpenAI model definitions to ~/.config/opencode/opencode.json by following: https://raw.githubusercontent.com/ndycode/oc-chatgpt-multi-auth/main/README.md
```

**option b: one-command install**

```bash
npx -y oc-chatgpt-multi-auth@latest
```

this writes the config to `~/.config/opencode/opencode.json`, backs up existing config, and clears the plugin cache.

> want legacy config (opencode v1.0.209 and below)? add `--legacy` flag.

**option c: manual setup**

1. **add the plugin** to `~/.config/opencode/opencode.json`:

   ```json
   {
     "plugin": ["oc-chatgpt-multi-auth@latest"]
   }
   ```

2. **login** with your chatgpt account:

   ```bash
   opencode auth login
   ```

3. **add models** — copy the [full configuration](#models) below

4. **use it:**

   ```bash
   opencode run "Hello" --model=openai/gpt-5.2 --variant=medium
   ```

</details>

<details>
<summary><b>for llm agents</b></summary>

### step-by-step instructions

1. edit the opencode configuration file at `~/.config/opencode/opencode.json`
   
   > **note**: this path works on all platforms. on windows, `~` resolves to your user home directory (e.g., `C:\Users\YourName`).

2. add the plugin to the `plugin` array:
   ```json
   {
     "plugin": ["oc-chatgpt-multi-auth@latest"]
   }
   ```

3. add the model definitions from the [full models configuration](#full-models-configuration-copy-paste-ready) section

4. set `provider` to `"openai"` and choose a model

### verification

```bash
opencode run "Hello" --model=openai/gpt-5.2 --variant=medium
```

</details>

---

## models

### model reference

| model | variants | notes |
|-------|----------|-------|
| `gpt-5.2` | none, low, medium, high, xhigh | latest gpt-5.2 with reasoning levels |
| `gpt-5.2-codex` | low, medium, high, xhigh | gpt-5.2 codex for code generation |
| `gpt-5.1-codex-max` | low, medium, high, xhigh | maximum context codex |
| `gpt-5.1-codex` | low, medium, high | standard codex |
| `gpt-5.1-codex-mini` | medium, high | lightweight codex |
| `gpt-5.1` | none, low, medium, high | gpt-5.1 base model |

**using variants:**
```bash
# modern opencode (v1.0.210+)
opencode run "Hello" --model=openai/gpt-5.2 --variant=high

# legacy opencode (v1.0.209 and below)
opencode run "Hello" --model=openai/gpt-5.2-high
```

<details>
<summary><b>full models configuration (copy-paste ready)</b></summary>

add this to your `~/.config/opencode/opencode.json`:

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
      },
      "models": {
        "gpt-5.2": {
          "name": "GPT 5.2 (OAuth)",
          "limit": { "context": 272000, "output": 128000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "none": { "reasoningEffort": "none" },
            "low": { "reasoningEffort": "low" },
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" },
            "xhigh": { "reasoningEffort": "xhigh" }
          }
        },
        "gpt-5.2-codex": {
          "name": "GPT 5.2 Codex (OAuth)",
          "limit": { "context": 272000, "output": 128000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "low": { "reasoningEffort": "low" },
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" },
            "xhigh": { "reasoningEffort": "xhigh" }
          }
        },
        "gpt-5.1-codex-max": {
          "name": "GPT 5.1 Codex Max (OAuth)",
          "limit": { "context": 272000, "output": 128000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "low": { "reasoningEffort": "low" },
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" },
            "xhigh": { "reasoningEffort": "xhigh" }
          }
        },
        "gpt-5.1-codex": {
          "name": "GPT 5.1 Codex (OAuth)",
          "limit": { "context": 272000, "output": 128000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "low": { "reasoningEffort": "low" },
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" }
          }
        },
        "gpt-5.1-codex-mini": {
          "name": "GPT 5.1 Codex Mini (OAuth)",
          "limit": { "context": 272000, "output": 128000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" }
          }
        },
        "gpt-5.1": {
          "name": "GPT 5.1 (OAuth)",
          "limit": { "context": 272000, "output": 128000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "none": { "reasoningEffort": "none" },
            "low": { "reasoningEffort": "low" },
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" }
          }
        }
      }
    }
  }
}
```

for legacy opencode (v1.0.209 and below), use `config/opencode-legacy.json` which has individual model entries like `gpt-5.2-low`, `gpt-5.2-medium`, etc.

</details>

---

## multi-account setup

add multiple chatgpt accounts for higher combined quotas. the plugin uses **health-aware rotation** with automatic failover and supports up to 20 accounts.

```bash
opencode auth login  # run again to add more accounts
```

**manage accounts:**
- `openai-accounts` — list all accounts
- `openai-accounts-switch` — switch active account
- `openai-accounts-status` — show rate limit status
- `openai-accounts-remove` — remove an account by index (new in v4.10.0)
- `openai-accounts-health` — check health of all accounts

**how rotation works:**
- health scoring tracks success/failure per account
- token bucket prevents hitting rate limits
- hybrid selection prefers healthy accounts with available tokens
- always retries when all accounts are rate-limited (waits for reset)
- 20% jitter on retry delays to avoid thundering herd

**per-project accounts (v4.10.0+):**

by default, each project directory gets its own account storage. this means you can have different active accounts per project. disable with `perProjectAccounts: false` in your config.

**storage locations:**
- per-project: `{project-root}/.opencode/openai-codex-accounts.json`
- global (when per-project disabled): `~/.opencode/openai-codex-accounts.json`

---

## troubleshooting

> **quick reset**: most issues can be resolved by deleting `~/.opencode/auth/openai.json` and running `opencode auth login` again.

### configuration paths (all platforms)

opencode uses `~/.config/opencode/` on **all platforms** including windows.

| file | path |
|------|------|
| main config | `~/.config/opencode/opencode.json` |
| auth tokens | `~/.opencode/auth/openai.json` |
| multi-account (global) | `~/.opencode/openai-codex-accounts.json` |
| multi-account (per-project) | `{project}/.opencode/openai-codex-accounts.json` |
| plugin config | `~/.opencode/openai-codex-auth-config.json` |
| debug logs | `~/.opencode/logs/codex-plugin/` |

> **windows users**: `~` resolves to your user home directory (e.g., `C:\Users\YourName`).

---

<details>
<summary><b>401 unauthorized error</b></summary>

**cause:** token expired or not authenticated.

**solutions:**
1. re-authenticate:
   ```bash
   opencode auth login
   ```
2. check auth file exists:
   ```bash
   cat ~/.opencode/auth/openai.json
   ```

</details>

<details>
<summary><b>browser doesn't open for oauth</b></summary>

**cause:** port 1455 conflict or ssh/wsl environment.

**solutions:**
1. **manual url paste:**
   - re-run `opencode auth login`
   - select **"chatgpt plus/pro (manual url paste)"**
   - paste the full redirect url (including `#code=...`) after login

2. **check port availability:**
   ```bash
   # macos/linux
   lsof -i :1455
   
   # windows
   netstat -ano | findstr :1455
   ```

3. **stop codex cli if running** — both use port 1455

</details>

<details>
<summary><b>model not found</b></summary>

**cause:** missing provider prefix or config mismatch.

**solutions:**
1. use `openai/` prefix:
   ```bash
   # correct
   --model=openai/gpt-5.2
   
   # wrong
   --model=gpt-5.2
   ```

2. verify model is in your config:
   ```json
   { "models": { "gpt-5.2": { ... } } }
   ```

</details>

<details>
<summary><b>rate limit exceeded</b></summary>

**cause:** chatgpt subscription usage limit reached.

**solutions:**
1. wait for reset (plugin shows timing in error message)
2. add more accounts: `opencode auth login`
3. switch to a different model family

</details>

<details>
<summary><b>multi-turn context lost</b></summary>

**cause:** old plugin version or missing config.

**solutions:**
1. update plugin:
   ```bash
   npx -y oc-chatgpt-multi-auth@latest
   ```
2. ensure config has:
   ```json
   {
     "include": ["reasoning.encrypted_content"],
     "store": false
   }
   ```

</details>

<details>
<summary><b>oauth callback issues (safari/wsl/docker)</b></summary>

**safari https-only mode:**
- use chrome or firefox instead, or
- temporarily disable safari > settings > privacy > "enable https-only mode"

**wsl2:**
- use vs code's port forwarding, or
- configure windows → wsl port forwarding

**ssh / remote:**
```bash
ssh -L 1455:localhost:1455 user@remote
```

**docker / containers:**
- oauth with localhost redirect doesn't work in containers
- use ssh port forwarding or manual url flow

</details>

---

## plugin compatibility

### oh-my-opencode

works alongside oh-my-opencode. no special configuration needed.

```json
{
  "plugin": [
    "oc-chatgpt-multi-auth@latest",
    "oh-my-opencode@latest"
  ]
}
```

### @tarquinen/opencode-dcp

list this plugin before dcp:

```json
{
  "plugin": [
    "oc-chatgpt-multi-auth@latest",
    "@tarquinen/opencode-dcp@latest"
  ]
}
```

### plugins you don't need

- **openai-codex-auth** — not needed. this plugin replaces the original.

---

## configuration

create `~/.opencode/openai-codex-auth-config.json` for optional settings:

### model behavior

| option | default | what it does |
|--------|---------|--------------|
| `codexMode` | `true` | uses codex-opencode bridge prompt (synced with latest codex cli) |

### account settings (v4.10.0+)

| option | default | what it does |
|--------|---------|--------------|
| `perProjectAccounts` | `true` | each project gets its own account storage |
| `toastDurationMs` | `5000` | how long toast notifications stay visible (ms) |

### retry behavior

| option | default | what it does |
|--------|---------|--------------|
| `retryAllAccountsRateLimited` | `true` | wait and retry when all accounts are rate-limited |
| `retryAllAccountsMaxWaitMs` | `0` | max wait time (0 = unlimited) |
| `retryAllAccountsMaxRetries` | `Infinity` | max retry attempts |

### environment variables

```bash
DEBUG_CODEX_PLUGIN=1 opencode                    # enable debug logging
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode         # log all api requests
CODEX_PLUGIN_LOG_LEVEL=debug opencode            # set log level (debug|info|warn|error)
CODEX_MODE=0 opencode                            # temporarily disable bridge prompt
```

for all options, see [docs/configuration.md](docs/configuration.md).

---

## documentation

- [getting started](docs/getting-started.md) — complete installation guide
- [configuration](docs/configuration.md) — all configuration options
- [troubleshooting](docs/troubleshooting.md) — common issues and fixes
- [architecture](docs/development/ARCHITECTURE.md) — how the plugin works

---

## credits

- [numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) by [numman-ali](https://github.com/numman-ali) — original plugin
- [ndycode](https://github.com/ndycode) — multi-account support and maintenance

## license

mit license. see [LICENSE](LICENSE) for details.

<details>
<summary><b>legal</b></summary>

### intended use

- personal / internal development only
- respect subscription quotas and data handling policies
- not for production services or bypassing intended limits

### warning

by using this plugin, you acknowledge:

- **terms of service risk** — this approach may violate tos of ai model providers
- **no guarantees** — apis may change without notice
- **assumption of risk** — you assume all legal, financial, and technical risks

### disclaimer

- not affiliated with openai. this is an independent open-source project.
- "chatgpt", "gpt-5", "codex", and "openai" are trademarks of openai, l.l.c.

</details>
