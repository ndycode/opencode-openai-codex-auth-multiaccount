# OpenAI Codex Auth Plugin for OpenCode

[![npm version](https://img.shields.io/npm/v/oc-chatgpt-multi-auth.svg)](https://www.npmjs.com/package/oc-chatgpt-multi-auth)
[![npm downloads](https://img.shields.io/npm/dw/oc-chatgpt-multi-auth.svg)](https://www.npmjs.com/package/oc-chatgpt-multi-auth)

OAuth plugin for OpenCode that lets you use ChatGPT Plus/Pro rate limits with models like `gpt-5.2`, `gpt-5-codex`, and `gpt-5.1-codex-max` (plus optional entitlement-gated Spark IDs and legacy Codex aliases).

> [!NOTE]
> **Renamed from `opencode-openai-codex-auth-multi`** — If you were using the old package, update your config to use `oc-chatgpt-multi-auth` instead. The rename was necessary because OpenCode blocks plugins containing `opencode-openai-codex-auth` in the name.

## What You Get

- **GPT-5.2, GPT-5 Codex, GPT-5.1 Codex Max** and all GPT-5.x variants via ChatGPT OAuth
- **Multi-account support** — Add up to 20 ChatGPT accounts, health-aware rotation with automatic failover
- **Per-project accounts** — Each project gets its own account storage (new in v4.10.0)
- **Workspace-aware identity persistence** — Keeps workspace/org identity stable across token refresh and verify-flagged restore flows
- **Click-to-switch** — Switch accounts directly from the OpenCode TUI
- **Beginner command toolkit** — Guided onboarding with `codex-help`, `codex-setup`, `codex-doctor`, and `codex-next`
- **Account metadata controls** — Per-account labels, tags, and notes with quick filtering
- **Safer backup/import flow** — Timestamped exports, import dry-run preview, and conditional pre-import backups when existing accounts are present
- **Startup preflight summary** — One-line health/readiness summary at plugin startup with suggested next step
- **Strict tool validation** — Automatically cleans schemas for compatibility with strict models
- **Auto-update notifications** — Get notified when a new version is available
- **21 template model presets** — Full variant system with reasoning levels (none/low/medium/high/xhigh)
- **Prompt caching** — Session-based caching for faster multi-turn conversations
- **Usage-aware errors** — Friendly messages with rate limit reset timing
- **Plugin compatible** — Works alongside other OpenCode plugins (oh-my-opencode, dcp, etc.)

---

<details open>
<summary><b>Terms of Service Warning — Read Before Installing</b></summary>

> [!CAUTION]
> This plugin uses OpenAI's official OAuth authentication (the same method as OpenAI's official Codex CLI) for personal development use with your ChatGPT Plus/Pro subscription.
>
> **This plugin is for personal development only:**
> - Not for commercial services, API resale, or multi-user applications
> - For production use, see [OpenAI Platform API](https://platform.openai.com/)
>
> **By using this plugin, you acknowledge:**
> - This is an unofficial tool not endorsed by OpenAI
> - Users are responsible for compliance with [OpenAI's Terms of Use](https://openai.com/policies/terms-of-use/)
> - You assume all risks associated with using this plugin

</details>

---

## Installation

<details open>
<summary><b>For Humans</b></summary>

**Option A: Let an LLM do it**

Paste this into any LLM agent (Claude Code, OpenCode, Cursor, etc.):

```
Install the oc-chatgpt-multi-auth plugin and add the OpenAI model definitions to ~/.config/opencode/opencode.json by following: https://raw.githubusercontent.com/ndycode/oc-chatgpt-multi-auth/main/README.md
```

**Option B: One-command install**

```bash
npx -y oc-chatgpt-multi-auth@latest
```

This writes the config to `~/.config/opencode/opencode.json`, backs up existing config, and clears the plugin cache.

> Want legacy config (OpenCode v1.0.209 and below)? Add `--legacy` flag.

**Option C: Manual setup**

1. **Add the plugin** to `~/.config/opencode/opencode.json`:

   ```json
   {
     "plugin": ["oc-chatgpt-multi-auth@latest"]
   }
   ```

2. **Login** with your ChatGPT account:

   ```bash
   opencode auth login
   ```

3. **Add models** — Copy the [full configuration](#models) below

4. **Use it:**

   ```bash
   opencode run "Hello" --model=openai/gpt-5.2 --variant=medium
   ```

</details>

<details>
<summary><b>For LLM Agents</b></summary>

### Step-by-Step Instructions

1. Edit the OpenCode configuration file at `~/.config/opencode/opencode.json`
   
   > **Note**: This path works on all platforms. On Windows, `~` resolves to your user home directory (e.g., `C:\Users\YourName`).

2. Add the plugin to the `plugin` array:
   ```json
   {
     "plugin": ["oc-chatgpt-multi-auth@latest"]
   }
   ```

3. Add the model definitions from the [Full Models Configuration](#full-models-configuration-copy-paste-ready) section

4. Set `provider` to `"openai"` and choose a model

### Verification

```bash
opencode run "Hello" --model=openai/gpt-5.2 --variant=medium
```

</details>

---

## Models

### Model Reference

| Model | Variants | Notes |
|-------|----------|-------|
| `gpt-5.2` | none, low, medium, high, xhigh | Latest GPT-5.2 with reasoning levels |
| `gpt-5-codex` | low, medium, high | Canonical Codex model for code generation (default: high) |
| `gpt-5.3-codex-spark` | low, medium, high, xhigh | Spark IDs are supported by the plugin, but access is entitlement-gated by account/workspace |
| `gpt-5.1-codex-max` | low, medium, high, xhigh | Maximum context Codex |
| `gpt-5.1-codex` | low, medium, high | Standard Codex |
| `gpt-5.1-codex-mini` | medium, high | Lightweight Codex |
| `gpt-5.1` | none, low, medium, high | GPT-5.1 base model |

Config templates intentionally omit Spark model IDs by default to reduce entitlement failures on unsupported accounts. Add Spark manually only if your workspace is entitled.

**Using variants:**
```bash
# Modern OpenCode (v1.0.210+)
opencode run "Hello" --model=openai/gpt-5.2 --variant=high

# Legacy OpenCode (v1.0.209 and below)
opencode run "Hello" --model=openai/gpt-5.2-high
```

<details>
<summary><b>Full Models Configuration (Copy-Paste Ready)</b></summary>

Add this to your `~/.config/opencode/opencode.json`:

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
        "gpt-5-codex": {
          "name": "GPT 5 Codex (OAuth)",
          "limit": { "context": 272000, "output": 128000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "low": { "reasoningEffort": "low" },
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" }
          },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed"
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

Optional Spark model block (manual add only when entitled):
```json
"gpt-5.3-codex-spark": {
  "name": "GPT 5.3 Codex Spark (OAuth)",
  "limit": { "context": 272000, "output": 128000 },
  "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
  "variants": {
    "low": { "reasoningEffort": "low" },
    "medium": { "reasoningEffort": "medium" },
    "high": { "reasoningEffort": "high" },
    "xhigh": { "reasoningEffort": "xhigh" }
  }
}
```

For legacy OpenCode (v1.0.209 and below), use `config/opencode-legacy.json` which has individual model entries like `gpt-5.2-low`, `gpt-5.2-medium`, etc.

</details>

---

## Multi-Account Setup

Add multiple ChatGPT accounts for higher combined quotas. The plugin uses **health-aware rotation** with automatic failover and supports up to 20 accounts.

```bash
opencode auth login  # Run again to add more accounts
```

---

## Account Management Tools

The plugin provides built-in tools for managing your OpenAI accounts. These are available directly in OpenCode — just ask the agent or type the tool name.

> **Note:** Tools were renamed from `openai-accounts-*` to `codex-*` in v4.12.0 for brevity.

### codex-list

List all configured accounts with status badges.

```
codex-list
```

Filter by tag:

```
codex-list tag="work"
```

Shows account labels, IDs, tags, active state, and rate-limit/cooldown markers.

---

### codex-switch

Switch to a different account. If `index` is omitted and your terminal supports menus, an interactive picker opens.

```
codex-switch index=2
```

or:

```
codex-switch
```

---

### codex-label

Set or clear a display label for an account. Useful for workspace naming.

```
codex-label index=2 label="Work"
```

Clear:

```
codex-label index=2 label=""
```

If `index` is omitted in interactive terminals, a picker opens.

---

### codex-tag

Set or clear comma-separated tags for filtering and grouping.

```
codex-tag index=2 tags="work,team-a"
```

Clear:

```
codex-tag index=2 tags=""
```

Use tags with `codex-list tag="work"`.

---

### codex-note

Set or clear a short per-account note for reminders.

```
codex-note index=2 note="primary for weekday daytime usage"
```

Clear:

```
codex-note index=2 note=""
```

---

### codex-help

Show beginner-friendly command guidance. Optional topic filter:

```
codex-help
codex-help topic="backup"
```

Available topics: `setup`, `switch`, `health`, `backup`, `dashboard`, `metrics`.

---

### codex-setup

Show readiness checklist for first-run onboarding and account health.

```
codex-setup
```

Open guided wizard (menu-driven when terminal supports it, checklist fallback otherwise):

```
codex-setup wizard=true
```

---

### codex-doctor

Run diagnostics with actionable findings.

```
codex-doctor
codex-doctor deep=true
```

Apply safe auto-fixes (`--fix` equivalent):
- Refreshes tokens where possible
- Persists refreshed credentials
- Switches active account to the healthiest eligible account

```
codex-doctor fix=true
```

---

### codex-next

Show the single most recommended next action based on current account/runtime state.

```
codex-next
```

---

### codex-status

Show detailed status including rate limits and health scores.

```
codex-status
```

---

### codex-metrics

Show live runtime metrics (request counts, latency, errors, retries, and safe mode).

```
codex-metrics
```

---

### codex-health

Check if all account tokens are still valid (read-only check).

```
codex-health
```

---

### codex-refresh

Refresh all OAuth tokens and save them to disk. Use this after long idle periods.

```
codex-refresh
```

`codex-health` validates. `codex-refresh` validates + refreshes + persists.

---

### codex-remove

Remove an account entry. If `index` is omitted and your terminal supports menus, an interactive picker opens.

```
codex-remove index=3
```

or:

```
codex-remove
```

---

### codex-export

Export accounts to JSON for backup/migration.

Explicit path:

```
codex-export path="~/backup/accounts.json"
```

Auto timestamped backup path (default behavior when `path` is omitted):

```
codex-export
```

Generated paths are stored in a `backups/` subdirectory near the active account storage file.

---

### codex-import

Import accounts from a JSON file (dedupe-aware merge).

Dry-run preview (no writes):

```
codex-import path="~/backup/accounts.json" dryRun=true
```

Apply import:

```
codex-import path="~/backup/accounts.json"
```

Before apply, the plugin creates an automatic timestamped pre-import backup when existing accounts are present.

---

### codex-dashboard

Show live account eligibility, retry budget usage, refresh queue metrics, and the recommended next step.

```
codex-dashboard
```

---

### Quick Reference

| Tool | What It Does | Example |
|------|--------------|---------|
| `codex-help` | Command guide by topic | `codex-help topic="setup"` |
| `codex-setup` | Readiness checklist/wizard | `codex-setup wizard=true` |
| `codex-next` | Best next action | `codex-next` |
| `codex-doctor` | Diagnostics and optional safe fixes | `codex-doctor fix=true` |
| `codex-list` | List/filter accounts | `codex-list tag="work"` |
| `codex-switch` | Switch active account | `codex-switch index=2` |
| `codex-label` | Set/clear display label | `codex-label index=2 label="Work"` |
| `codex-tag` | Set/clear tag list | `codex-tag index=2 tags="work,team-a"` |
| `codex-note` | Set/clear account note | `codex-note index=2 note="night backup"` |
| `codex-status` | Per-account health/rate limit detail | `codex-status` |
| `codex-dashboard` | Live selection and retry view | `codex-dashboard` |
| `codex-metrics` | Runtime metrics summary | `codex-metrics` |
| `codex-health` | Validate token health (read-only) | `codex-health` |
| `codex-refresh` | Refresh and persist tokens | `codex-refresh` |
| `codex-remove` | Remove account entry | `codex-remove index=3` |
| `codex-export` | Export account backups | `codex-export` |
| `codex-import` | Dry-run or apply imports | `codex-import path="~/backup/accounts.json" dryRun=true` |

---

### Sample Output (codex-list)

```
Codex Accounts (3):

  [1] Account 1 (user@gmail.com, workspace:Work, tags:work,team-a)  active
  [2] Account 2 (backup@email.com, tags:backup)                      ok
  [3] Account 3 (personal@email.com)                                 rate-limited

Storage: ~/.opencode/openai-codex-accounts.json
```

## Rotation Behavior

**How rotation works:**
- Health scoring tracks success/failure per account
- Token bucket prevents hitting rate limits
- Hybrid selection prefers healthy accounts with available tokens
- Always retries when all accounts are rate-limited (waits for reset with live countdown)
- 20% jitter on retry delays to avoid thundering herd
- Auto-removes accounts after 3 consecutive auth failures (new in v4.11.0)

**Per-project accounts (v4.10.0+):**

By default, each project gets its own account storage namespace. This means you can keep different active accounts per project without writing account files into your repo. Works from subdirectories too; the plugin walks up to find the project root (v4.11.0). Disable with `perProjectAccounts: false` in your config.

**Storage locations:**
- Per-project: `~/.opencode/projects/{project-key}/openai-codex-accounts.json`
- Global (when per-project disabled): `~/.opencode/openai-codex-accounts.json`

---

## Troubleshooting

> **Quick reset**: Most issues can be resolved by deleting `~/.opencode/auth/openai.json` and running `opencode auth login` again.

### Configuration Paths (All Platforms)

OpenCode uses `~/.config/opencode/` on **all platforms** including Windows.

| File | Path |
|------|------|
| Main config | `~/.config/opencode/opencode.json` |
| Auth tokens | `~/.opencode/auth/openai.json` |
| Multi-account (global) | `~/.opencode/openai-codex-accounts.json` |
| Multi-account (per-project) | `~/.opencode/projects/{project-key}/openai-codex-accounts.json` |
| Flagged accounts | `~/.opencode/openai-codex-flagged-accounts.json` |
| Plugin config | `~/.opencode/openai-codex-auth-config.json` |
| Debug logs | `~/.opencode/logs/codex-plugin/` |

> **Windows users**: `~` resolves to your user home directory (e.g., `C:\Users\YourName`).

---

<details>
<summary><b>401 Unauthorized Error</b></summary>

**Cause:** Token expired or not authenticated.

**Solutions:**
1. Re-authenticate:
   ```bash
   opencode auth login
   ```
2. Check auth file exists:
   ```bash
   cat ~/.opencode/auth/openai.json
   ```

</details>

<details>
<summary><b>Browser Doesn't Open for OAuth</b></summary>

**Cause:** Port 1455 conflict or SSH/WSL environment.

**Solutions:**
1. **Manual URL paste:**
   - Re-run `opencode auth login`
   - Select **"ChatGPT Plus/Pro (manual URL paste)"**
   - Paste the full redirect URL (including `#code=...`) after login

2. **Check port availability:**
   ```bash
   # macOS/Linux
   lsof -i :1455
   
   # Windows
   netstat -ano | findstr :1455
   ```

3. **Stop Codex CLI if running** — Both use port 1455

</details>

<details>
<summary><b>Model Not Found</b></summary>

**Cause:** Missing provider prefix or config mismatch.

**Solutions:**
1. Use `openai/` prefix:
   ```bash
   # Correct
   --model=openai/gpt-5.2
   
   # Wrong
   --model=gpt-5.2
   ```

2. Verify model is in your config:
   ```json
   { "models": { "gpt-5.2": { ... } } }
   ```

</details>

<details>
<summary><b>Unsupported Codex Model for ChatGPT Account</b></summary>

**Error example:** `Bad Request: {"detail":"The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account."}`

**Cause:** Active workspace/account is not entitled for the requested Codex model.

**Solutions:**
1. Re-auth to refresh workspace selection (most common Spark fix):
   ```bash
   opencode auth login
   ```
2. Add another entitled account/workspace. The plugin will try remaining accounts/workspaces before model fallback.
3. Enable automatic fallback only if you want degraded-model retries when Spark is not entitled:
   ```bash
   CODEX_AUTH_UNSUPPORTED_MODEL_POLICY=fallback opencode
   ```
4. Use custom fallback chain in `~/.opencode/openai-codex-auth-config.json`:
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
5. Verify effective upstream model when needed:
   ```bash
   ENABLE_PLUGIN_REQUEST_LOGGING=1 CODEX_PLUGIN_LOG_BODIES=1 opencode run "ping" --model=openai/gpt-5.3-codex-spark
   ```
   The UI can keep showing your selected model while fallback is applied internally.

</details>

<details>
<summary><b>Rate Limit Exceeded</b></summary>

**Cause:** ChatGPT subscription usage limit reached.

**Solutions:**
1. Wait for reset (plugin shows timing in error message)
2. Add more accounts: `opencode auth login`
3. Switch to a different model family

</details>

<details>
<summary><b>Multi-Turn Context Lost</b></summary>

**Cause:** Old plugin version or missing config.

**Solutions:**
1. Update plugin:
   ```bash
   npx -y oc-chatgpt-multi-auth@latest
   ```
2. Ensure config has:
   ```json
   {
     "include": ["reasoning.encrypted_content"],
     "store": false
   }
   ```

</details>

<details>
<summary><b>OAuth Callback Issues (Safari/WSL/Docker)</b></summary>

**Safari HTTPS-only mode:**
- Use Chrome or Firefox instead, or
- Temporarily disable Safari > Settings > Privacy > "Enable HTTPS-only mode"

**WSL2:**
- Use VS Code's port forwarding, or
- Configure Windows → WSL port forwarding

**SSH / Remote:**
```bash
ssh -L 1455:localhost:1455 user@remote
```

**Docker / Containers:**
- OAuth with localhost redirect doesn't work in containers
- Use SSH port forwarding or manual URL flow

</details>

---

## Plugin Compatibility

### oh-my-opencode

Works alongside oh-my-opencode. No special configuration needed.

```json
{
  "plugin": [
    "oc-chatgpt-multi-auth@latest",
    "oh-my-opencode@latest"
  ]
}
```

### @tarquinen/opencode-dcp

List this plugin before dcp:

```json
{
  "plugin": [
    "oc-chatgpt-multi-auth@latest",
    "@tarquinen/opencode-dcp@latest"
  ]
}
```

### Plugins You Don't Need

- **openai-codex-auth** — Not needed. This plugin replaces the original.

---

## Configuration

Create `~/.opencode/openai-codex-auth-config.json` for optional settings:

### Model Behavior

| Option | Default | What It Does |
|--------|---------|--------------|
| `requestTransformMode` | `native` | Request shaping mode: `native` keeps OpenCode payloads unchanged; `legacy` enables Codex compatibility rewrites |
| `codexMode` | `true` | Legacy-only bridge prompt behavior (applies when `requestTransformMode=legacy`) |
| `codexTuiV2` | `true` | Enables Codex-style terminal UI output (set `false` for legacy output) |
| `codexTuiColorProfile` | `truecolor` | Terminal color profile for Codex UI (`truecolor`, `ansi256`, `ansi16`) |
| `codexTuiGlyphMode` | `ascii` | Glyph mode for Codex UI (`ascii`, `unicode`, `auto`) |
| `fastSession` | `false` | Forces low-latency settings per request (`reasoningEffort=none/low`, `reasoningSummary=auto`, `textVerbosity=low`) |
| `fastSessionStrategy` | `hybrid` | `hybrid` speeds simple turns but keeps full-depth on complex prompts; `always` forces fast tuning on every turn |
| `fastSessionMaxInputItems` | `30` | Max input items kept when fast tuning is applied |

### Account Settings (v4.10.0+)

| Option | Default | What It Does |
|--------|---------|--------------|
| `perProjectAccounts` | `true` | Each project gets its own account storage namespace under `~/.opencode/projects/` |
| `toastDurationMs` | `5000` | How long toast notifications stay visible (ms) |
| `beginnerSafeMode` | `false` | Beginner-safe retry profile: conservative retry budget, disables all-accounts wait/retry, and caps all-accounts retries |

### Retry Behavior

| Option | Default | What It Does |
|--------|---------|--------------|
| `retryProfile` | `balanced` | Global retry budget profile (`conservative`, `balanced`, `aggressive`) |
| `retryBudgetOverrides` | `{}` | Per-class retry budget overrides (`authRefresh`, `network`, `server`, `rateLimitShort`, `rateLimitGlobal`, `emptyResponse`) |
| `retryAllAccountsRateLimited` | `true` | Wait and retry when all accounts are rate-limited |
| `retryAllAccountsMaxWaitMs` | `0` | Max wait time (0 = unlimited) |
| `retryAllAccountsMaxRetries` | `Infinity` | Max retry attempts |
| `unsupportedCodexPolicy` | `strict` | Unsupported-model behavior: `strict` (return entitlement error) or `fallback` (retry next model in fallback chain) |
| `fallbackOnUnsupportedCodexModel` | `false` | Legacy fallback toggle mapped to `unsupportedCodexPolicy` (prefer using `unsupportedCodexPolicy`) |
| `fallbackToGpt52OnUnsupportedGpt53` | `true` | Legacy compatibility toggle for the `gpt-5.3-codex -> gpt-5.2-codex` edge when generic fallback is enabled |
| `unsupportedCodexFallbackChain` | `{}` | Optional per-model fallback-chain override (map of `model -> [fallback1, fallback2, ...]`) |
| `fetchTimeoutMs` | `60000` | Request timeout to Codex backend (ms) |
| `streamStallTimeoutMs` | `45000` | Abort non-stream parsing if SSE stalls (ms) |

Default unsupported-model fallback chain (used when `unsupportedCodexPolicy` is `fallback`):
- `gpt-5.3-codex -> gpt-5-codex -> gpt-5.2-codex`
- `gpt-5.3-codex-spark -> gpt-5-codex -> gpt-5.3-codex -> gpt-5.2-codex` (applies if you manually select Spark model IDs)
- `gpt-5.2-codex -> gpt-5-codex`
- `gpt-5.1-codex -> gpt-5-codex`

When `beginnerSafeMode` is enabled, runtime behavior is intentionally conservative:
- Retry profile is forced to `conservative`
- `retryAllAccountsRateLimited` is forced `false`
- `retryAllAccountsMaxRetries` is capped to `1`

### Environment Variables

```bash
DEBUG_CODEX_PLUGIN=1 opencode                    # Enable debug logging
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode         # Log request metadata
CODEX_PLUGIN_LOG_BODIES=1 opencode               # Include raw request/response payloads in request logs (sensitive)
CODEX_PLUGIN_LOG_LEVEL=debug opencode            # Set log level (debug|info|warn|error)
CODEX_AUTH_REQUEST_TRANSFORM_MODE=legacy opencode # Re-enable legacy Codex request rewrites
CODEX_MODE=0 opencode                            # Temporarily disable bridge prompt
CODEX_TUI_V2=0 opencode                          # Disable Codex-style UI (legacy output)
CODEX_TUI_COLOR_PROFILE=ansi16 opencode          # Force UI color profile
CODEX_TUI_GLYPHS=unicode opencode                # Override glyph mode (ascii|unicode|auto)
CODEX_AUTH_PREWARM=0 opencode                    # Disable startup prewarm (prompt/instruction cache warmup)
CODEX_AUTH_FAST_SESSION=1 opencode               # Enable faster response defaults
CODEX_AUTH_FAST_SESSION_STRATEGY=always opencode # Force fast mode for all prompts
CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS=24 opencode # Tune fast-mode history window
CODEX_AUTH_BEGINNER_SAFE_MODE=1 opencode         # Enable beginner-safe runtime profile
CODEX_AUTH_RETRY_PROFILE=aggressive opencode     # Override retry profile (ignored when beginner safe mode is on)
CODEX_AUTH_RETRY_ALL_RATE_LIMITED=0 opencode     # Disable all-accounts wait-and-retry
CODEX_AUTH_RETRY_ALL_MAX_WAIT_MS=30000 opencode  # Cap all-accounts wait duration
CODEX_AUTH_RETRY_ALL_MAX_RETRIES=1 opencode      # Cap all-accounts retry attempts
CODEX_AUTH_UNSUPPORTED_MODEL_POLICY=fallback opencode # Enable generic unsupported-model fallback
CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL=1 opencode # Legacy fallback toggle (prefer policy var above)
CODEX_AUTH_FALLBACK_GPT53_TO_GPT52=0 opencode    # Disable only the legacy gpt-5.3 -> gpt-5.2 edge
CODEX_AUTH_FETCH_TIMEOUT_MS=120000 opencode      # Override request timeout
CODEX_AUTH_STREAM_STALL_TIMEOUT_MS=60000 opencode # Override SSE stall timeout
```

For all options, see [docs/configuration.md](docs/configuration.md).

---

## Documentation

- [Getting Started](docs/getting-started.md) — Complete installation guide
- [Configuration](docs/configuration.md) — All configuration options
- [Troubleshooting](docs/troubleshooting.md) — Common issues and fixes
- [Architecture](docs/development/ARCHITECTURE.md) — How the plugin works

---

## Credits

- [numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) by [numman-ali](https://github.com/numman-ali) — Original plugin
- [ndycode](https://github.com/ndycode) — Multi-account support and maintenance

## License

MIT License. See [LICENSE](LICENSE) for details.

<details>
<summary><b>Legal</b></summary>

### Intended Use

- Personal / internal development only
- Respect subscription quotas and data handling policies
- Not for production services or bypassing intended limits

### Warning

By using this plugin, you acknowledge:

- **Terms of Service risk** — This approach may violate ToS of AI model providers
- **No guarantees** — APIs may change without notice
- **Assumption of risk** — You assume all legal, financial, and technical risks

### Disclaimer

- Not affiliated with OpenAI. This is an independent open-source project.
- "ChatGPT", "GPT-5", "Codex", and "OpenAI" are trademarks of OpenAI, L.L.C.

</details>
