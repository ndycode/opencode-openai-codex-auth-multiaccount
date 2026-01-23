# OpenAI Codex Auth Plugin for OpenCode

[![npm version](https://img.shields.io/npm/v/opencode-openai-codex-auth-multi.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth-multi)
[![npm downloads](https://img.shields.io/npm/dw/opencode-openai-codex-auth-multi.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth-multi)
[![Tests](https://github.com/ndycode/opencode-openai-codex-auth-multi/actions/workflows/ci.yml/badge.svg)](https://github.com/ndycode/opencode-openai-codex-auth-multi/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![X (Twitter)](https://img.shields.io/badge/X-@ndycode-000000?style=flat&logo=x)](https://x.com/ndycode)

Enable OpenCode to authenticate against **OpenAI's Codex backend** via OAuth so you can use ChatGPT Plus/Pro rate limits and access models like `gpt-5.2`, `gpt-5.2-codex`, and `gpt-5.1-codex-max` with your ChatGPT credentials.

## What You Get

- **GPT-5.2, GPT-5.2 Codex, GPT-5.1 Codex Max** and all GPT-5.x variants via ChatGPT OAuth
- **Multi-account support** — add multiple ChatGPT accounts, auto-rotates when rate-limited
- **22 model presets** — full variant system with reasoning levels (none/low/medium/high/xhigh)
- **Prompt caching** — session-based caching for faster multi-turn conversations
- **Usage-aware errors** — friendly messages with rate limit reset timing
- **Plugin compatible** — works alongside other OpenCode plugins (oh-my-opencode, dcp, etc.)

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
Install the opencode-openai-codex-auth-multi plugin and add the OpenAI model definitions to ~/.config/opencode/opencode.json by following: https://raw.githubusercontent.com/ndycode/opencode-openai-codex-auth-multi/main/README.md
```

**Option B: One-command install**

```bash
npx -y opencode-openai-codex-auth-multi@latest
```

This writes the config to `~/.config/opencode/opencode.json`, backs up existing config, and clears the plugin cache.

> Want legacy config (OpenCode v1.0.209 and below)? Add `--legacy` flag.

**Option C: Manual setup**

1. **Add the plugin** to `~/.config/opencode/opencode.json`:

   ```json
   {
     "plugin": ["opencode-openai-codex-auth-multi@latest"]
   }
   ```

2. **Login** with your ChatGPT account:

   ```bash
   opencode auth login
   ```

3. **Add models** — copy the [full configuration](#models) below

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
     "plugin": ["opencode-openai-codex-auth-multi@latest"]
   }
   ```

3. Add the model definitions from the [Full models configuration](#full-models-configuration-copy-paste-ready) section

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
| `gpt-5.2-codex` | low, medium, high, xhigh | GPT-5.2 Codex for code generation |
| `gpt-5.1-codex-max` | low, medium, high, xhigh | Maximum context Codex |
| `gpt-5.1-codex` | low, medium, high | Standard Codex |
| `gpt-5.1-codex-mini` | medium, high | Lightweight Codex |
| `gpt-5.1` | none, low, medium, high | GPT-5.1 base model |

**Using variants:**
```bash
# Modern OpenCode (v1.0.210+)
opencode run "Hello" --model=openai/gpt-5.2 --variant=high

# Legacy OpenCode (v1.0.209 and below)
opencode run "Hello" --model=openai/gpt-5.2-high
```

<details>
<summary><b>Full models configuration (copy-paste ready)</b></summary>

Add this to your `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth-multi@latest"],
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

For legacy OpenCode (v1.0.209 and below), use `config/opencode-legacy.json` which has individual model entries like `gpt-5.2-low`, `gpt-5.2-medium`, etc.

</details>

---

## Multi-Account Setup

Add multiple ChatGPT accounts for higher combined quotas. The plugin automatically rotates between accounts when one is rate-limited.

```bash
opencode auth login  # Run again to add more accounts
```

**Manage accounts:**
- `openai-accounts` — List all accounts
- `openai-accounts-switch` — Switch active account
- `openai-accounts-status` — Show rate limit status

**Storage:** `~/.opencode/openai-codex-accounts.json`

---

## Troubleshoot

> **Quick Reset**: Most issues can be resolved by deleting `~/.opencode/auth/openai.json` and running `opencode auth login` again.

### Configuration Path (All Platforms)

OpenCode uses `~/.config/opencode/` on **all platforms** including Windows.

| File | Path |
|------|------|
| Main config | `~/.config/opencode/opencode.json` |
| Auth tokens | `~/.opencode/auth/openai.json` |
| Multi-account | `~/.opencode/openai-codex-accounts.json` |
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
   - Select **"ChatGPT Plus/Pro (Manual URL Paste)"**
   - Paste the full redirect URL after login

2. **Check port availability:**
   ```bash
   # macOS/Linux
   lsof -i :1455
   
   # Windows
   netstat -ano | findstr :1455
   ```

3. **Stop Codex CLI if running** — both use port 1455

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
   npx -y opencode-openai-codex-auth-multi@latest
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

**Safari HTTPS-Only Mode:**
- Use Chrome or Firefox instead, or
- Temporarily disable Safari > Settings > Privacy > "Enable HTTPS-Only Mode"

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
    "opencode-openai-codex-auth-multi@latest",
    "oh-my-opencode@latest"
  ]
}
```

### @tarquinen/opencode-dcp

List this plugin BEFORE DCP:

```json
{
  "plugin": [
    "opencode-openai-codex-auth-multi@latest",
    "@tarquinen/opencode-dcp@latest"
  ]
}
```

### Plugins you don't need

- **openai-codex-auth** — Not needed. This plugin replaces the original.

---

## Configuration

Create `~/.opencode/openai-codex-auth-config.json` for optional settings:

### Model Behavior

| Option | Default | What it does |
|--------|---------|--------------|
| `codexMode` | `true` | Uses Codex-OpenCode bridge prompt (synced with latest Codex CLI) |

### Environment Variables

```bash
DEBUG_CODEX_PLUGIN=1 opencode                    # Enable debug logging
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode         # Log all API requests
CODEX_MODE=0 opencode                            # Temporarily disable bridge prompt
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

- [numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) by [@nummanali](https://x.com/nummanali) — Original plugin
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
