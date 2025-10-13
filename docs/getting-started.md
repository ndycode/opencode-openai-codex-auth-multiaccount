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
- **Node.js** 18+ (for OpenCode)

## Installation

### Step 1: Add Plugin to Config

OpenCode automatically installs plugins - no `npm install` needed!

**Choose your configuration style:**

#### Option A: Full Configuration (Recommended)

Get 9 pre-configured model variants with optimal settings.

Add this to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth"],
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
        "gpt-5-codex-low": {
          "name": "GPT 5 Codex Low (OAuth)",
          "options": {
            "reasoningEffort": "low",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5-codex-medium": {
          "name": "GPT 5 Codex Medium (OAuth)",
          "options": {
            "reasoningEffort": "medium",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5-codex-high": {
          "name": "GPT 5 Codex High (OAuth)",
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5-minimal": {
          "name": "GPT 5 Minimal (OAuth)",
          "options": {
            "reasoningEffort": "minimal",
            "reasoningSummary": "auto",
            "textVerbosity": "low",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5-low": {
          "name": "GPT 5 Low (OAuth)",
          "options": {
            "reasoningEffort": "low",
            "reasoningSummary": "auto",
            "textVerbosity": "low",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5-medium": {
          "name": "GPT 5 Medium (OAuth)",
          "options": {
            "reasoningEffort": "medium",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5-high": {
          "name": "GPT 5 High (OAuth)",
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "high",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5-mini": {
          "name": "GPT 5 Mini (OAuth)",
          "options": {
            "reasoningEffort": "low",
            "reasoningSummary": "auto",
            "textVerbosity": "low",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },
        "gpt-5-nano": {
          "name": "GPT 5 Nano (OAuth)",
          "options": {
            "reasoningEffort": "minimal",
            "reasoningSummary": "auto",
            "textVerbosity": "low",
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
- ✅ GPT-5 Codex (Low/Medium/High reasoning)
- ✅ GPT-5 (Minimal/Low/Medium/High reasoning)
- ✅ gpt-5-mini, gpt-5-nano (lightweight variants)
- ✅ All visible in OpenCode model selector
- ✅ Optimal settings for each reasoning level

#### Option B: Minimal Configuration

Just want to get started quickly?

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth"],
  "model": "openai/gpt-5-codex"
}
```

Save to `~/.config/opencode/opencode.json`

**Trade-off**: Uses default settings (medium reasoning), no model variants in selector.

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

### Step 3: Test It

```bash
# Quick test
opencode run "write hello world to test.txt" --model=openai/gpt-5-codex

# Or start interactive session
opencode
```

If using full config, you'll see all 9 variants in the model selector!

---

## Configuration Locations

OpenCode checks multiple config files in order:

1. **Project config**: `./.opencode.json` (current directory)
2. **Parent configs**: Walks up directory tree
3. **Global config**: `~/.config/opencode/opencode.json`

**Recommendation**: Use global config for plugin, project config for model/agent overrides.

---

## ⚠️ Updating the Plugin (Important!)

**OpenCode does NOT automatically update plugins.**

When a new version is released, you must manually update:

```bash
# Step 1: Clear plugin cache
(cd ~ && sed -i.bak '/"opencode-openai-codex-auth"/d' .cache/opencode/package.json && rm -rf .cache/opencode/node_modules/opencode-openai-codex-auth)

# Step 2: Restart OpenCode - it will reinstall the latest version
opencode
```

**When to update:**
- New features released
- Bug fixes available
- Security updates

**Check for updates**: [Releases Page](https://github.com/numman-ali/opencode-openai-codex-auth/releases)

**Pro tip**: Subscribe to release notifications on GitHub to get notified of updates.

---

## Local Development Setup

For plugin development or testing unreleased changes:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-openai-codex-auth/dist"]
}
```

**Note**: Must point to `dist/` folder (built output), not root.

**Build the plugin:**
```bash
cd opencode-openai-codex-auth
npm install
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
