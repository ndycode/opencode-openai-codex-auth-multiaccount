# Getting Started

Complete installation and setup guide for the OpenCode OpenAI Codex Auth Plugin.

## ⚠️ Before You Begin

**This plugin is for personal development use only.** It uses OpenAI's official OAuth authentication for individual coding assistance with your ChatGPT Plus/Pro subscription.

**Not intended for:** Commercial services, API resale, multi-user applications, or any use that violates [OpenAI's Terms of Use](https://openai.com/policies/terms-of-use/).

For production applications, use the [OpenAI Platform API](https://platform.openai.com/).

---

## Prerequisites

- **OpenCode** installed ([installation guide](https://opencode.ai))
- **ChatGPT Plus or Pro subscription** (required for Codex access)
- **Node.js** 20+ (for OpenCode)

## Installation

### Install/update from npm (recommended)

Works on **Windows, macOS, and Linux**:

```bash
npx -y opencode-openai-codex-auth-multiaccount@latest
```

This writes the **global** config at `~/.config/opencode/opencode.json`, backs it up, and clears the OpenCode plugin cache so the latest version installs.

Need legacy config (OpenCode v1.0.209 and below)?

```bash
npx -y opencode-openai-codex-auth-multiaccount@latest --legacy
```

### Install from source (optional)

```bash
git clone https://github.com/ndycode/opencode-openai-codex-auth-multiaccount.git
cd opencode-openai-codex-auth-multiaccount
npm ci
npm run build
```

Point OpenCode at the local build output (replace with your absolute path):

```json
{
  "plugin": ["file:///absolute/path/to/opencode-openai-codex-auth-multiaccount/dist"]
}
```

---

### Step 1: Add Plugin to Config

OpenCode can load plugins from npm (by name) or from a local build (`file://` URL).

If you installed from source, set `"plugin"` to your local `dist/` folder (see the example above).

**Choose your configuration style:**

#### ✅ Recommended: Full Configuration

**Recommended**: Use the full configuration for the best UX and stable behavior with GPT 5.x/Codex models.

**Why the full config is recommended:**
- GPT 5 models can be temperamental and need proper configuration
- Minimal configs are intended for debugging only and may miss required model metadata
- OpenCode features require proper model metadata
- This configuration has been tested and verified to work


Add this to `~/.config/opencode/opencode.json` (if you installed from source, replace `"plugin"` with your local `file:///.../dist` path):

**Tip**: The snippet below is a truncated excerpt. For the complete legacy list, copy `config/opencode-legacy.json`. For the modern variants config (OpenCode v1.0.210+), use `config/opencode-modern.json`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth-multiaccount"],
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
        "gpt-5.1-codex-low": {
          "name": "GPT 5.1 Codex Low (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "low",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-codex-medium": {
          "name": "GPT 5.1 Codex Medium (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "medium",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-codex-high": {
          "name": "GPT 5.1 Codex High (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-codex-max": {
          "name": "GPT 5.1 Codex Max (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-codex-max-low": {
          "name": "GPT 5.1 Codex Max Low (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "low",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-codex-max-medium": {
          "name": "GPT 5.1 Codex Max Medium (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "medium",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-codex-max-high": {
          "name": "GPT 5.1 Codex Max High (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-codex-max-xhigh": {
          "name": "GPT 5.1 Codex Max Extra High (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "xhigh",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-codex-mini-medium": {
          "name": "GPT 5.1 Codex Mini Medium (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "medium",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-codex-mini-high": {
          "name": "GPT 5.1 Codex Mini High (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-low": {
          "name": "GPT 5.1 Low (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "low",
            "reasoningSummary": "auto",
            "textVerbosity": "low",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-medium": {
          "name": "GPT 5.1 Medium (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "medium",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5.1-high": {
          "name": "GPT 5.1 High (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "high",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        }
      }
    }
  }
}
```

  **What you get:**
  - ✅ GPT 5.2 (None/Low/Medium/High/xHigh reasoning)
  - ✅ GPT 5.2 Codex (Low/Medium/High/xHigh reasoning)
  - ✅ GPT 5.1 Codex Max (Low/Medium/High/xHigh reasoning presets)
  - ✅ GPT 5.1 Codex (Low/Medium/High reasoning)
  - ✅ GPT 5.1 Codex Mini (Medium/High reasoning)
  - ✅ GPT 5.1 (None/Low/Medium/High reasoning)
  - ✅ 272k context + 128k output window for all GPT 5.x presets.
  - ✅ All visible in OpenCode model selector
  - ✅ Optimal settings for each reasoning level

> **Note**: All `gpt-5.1-codex-mini*` presets use 272k context / 128k output limits.
>
> **Note**: Codex Max presets map to the `gpt-5.1-codex-max` slug with 272k context and 128k output. Use `gpt-5.1-codex-max-low/medium/high/xhigh` to pick the reasoning level (only `-xhigh` uses `xhigh` reasoning).
>
> **Note**: GPT 5.2 and GPT 5.2 Codex support `xhigh` reasoning. Use explicit reasoning levels (e.g., `gpt-5.2-xhigh`, `gpt-5.2-codex-xhigh`) for precise control.

Prompt caching is enabled out of the box: when OpenCode sends its session identifier as `prompt_cache_key`, the plugin forwards it untouched so multi-turn runs reuse prior work. The CODEX_MODE bridge prompt bundled with the plugin is kept in sync with the latest Codex CLI release, so the OpenCode UI and Codex share the same tool contract. If you hit your ChatGPT subscription limits, the plugin returns a friendly Codex-style message with the 5-hour and weekly usage windows so you know when capacity resets.

> **Tip**: The full configuration is strongly recommended for the best OpenCode UX (model metadata, variants/presets, and predictable behavior). Minimal configs are intended for debugging only.

#### ⚠️ Minimal Configuration (Advanced/Debugging Only)

Minimal configs can be useful for debugging, but they do not include the full model metadata/presets. Expect fewer OpenCode UI features.

```json
// ⚠️ Debugging only
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth-multiaccount"],
  "model": "openai/gpt-5-codex"
}
```

**Limitations:**
- Missing model metadata can reduce OpenCode UI features (picker labels, limits, etc.)
- You won’t get the full preset/variant matrix from `config/opencode-*.json`


### Step 2: Authenticate

```bash
opencode auth login
```

1. Select **"OpenAI"**
2. Choose **"ChatGPT Plus/Pro (Codex Subscription)"**
3. Browser opens automatically for OAuth flow
4. Log in with your ChatGPT account
5. Done! Token saved to `~/.opencode/auth/openai.json`

**⚠️ Important**: If you have the official Codex CLI running, stop it first (both use port 1455 for OAuth callback).

**Manual fallback**: On SSH/WSL/remote environments, pick **"ChatGPT Plus/Pro (Manual URL Paste)"** and paste the full redirect URL after login.

### Step 3: Test It

```bash
# Quick test
opencode run "write hello world to test.txt" --model=openai/gpt-5.1-codex-medium

# Or start interactive session
opencode
```

You'll see all 22 GPT 5.x variants (GPT 5.2, GPT 5.2 Codex, Codex Max, Codex, Codex Mini, and GPT 5.1 presets) in the model selector!

---

## Configuration Locations

OpenCode checks multiple config files in order:

1. **Project config**: `./.opencode.json` (current directory)
2. **Parent configs**: Walks up directory tree
3. **Global config**: `~/.config/opencode/opencode.json`

**Recommendation**: Use global config for plugin, project config for model/agent overrides.

---

## ⚠️ Updating the Plugin (Important!)

### If you installed from source

```bash
cd opencode-openai-codex-auth-multiaccount
git pull
npm ci
npm run build
```

### If you installed from npm (once published)

OpenCode caches plugins. To install the latest version, re-run the installer:

```bash
npx -y opencode-openai-codex-auth-multiaccount@latest
```

Legacy OpenCode (v1.0.209 and below):

```bash
npx -y opencode-openai-codex-auth-multiaccount@latest --legacy
```

**When to update:**
- New features released
- Bug fixes available
- Security updates

**Check for updates**: [Releases Page](https://github.com/ndycode/opencode-openai-codex-auth-multiaccount/releases)

**Pro tip**: Subscribe to release notifications on GitHub to get notified of updates.

---

## Local Development Setup

For plugin development or testing unreleased changes:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-openai-codex-auth-multiaccount/dist"]
}
```

**Note**: Must point to `dist/` folder (built output), not root.

**Build the plugin:**
```bash
cd opencode-openai-codex-auth-multiaccount
npm ci
npm run build
```

---

## Verifying Installation

### Check Plugin is Loaded

```bash
opencode --version
# Should not show any plugin errors
```

### Check Authentication

```bash
cat ~/.opencode/auth/openai.json
# Should show OAuth credentials (if authenticated)
```

### Test API Access

```bash
# Enable logging to verify requests
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5-codex

# Check logs
ls ~/.opencode/logs/codex-plugin/
# Should show request logs
```

---

## Next Steps

- [Configuration Guide](configuration.md) - Advanced config options
- [Troubleshooting](troubleshooting.md) - Common issues and solutions
- [Developer Docs](development/ARCHITECTURE.md) - Technical deep dive

**Back to**: [Documentation Home](index.md)
