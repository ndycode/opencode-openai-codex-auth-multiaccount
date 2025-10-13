# Configuration Guide

Complete reference for configuring the OpenCode OpenAI Codex Auth Plugin.

## Quick Reference

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
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        }
      }
    }
  }
}
```

---

## Configuration Options

### reasoningEffort

Controls computational effort for reasoning.

**GPT-5 Values:**
- `minimal` - Fastest, least reasoning
- `low` - Light reasoning
- `medium` - Balanced (default)
- `high` - Deep reasoning

**GPT-5-Codex Values:**
- `low` - Fastest for code
- `medium` - Balanced (default)
- `high` - Maximum code quality

**Note**: `minimal` auto-converts to `low` for gpt-5-codex (API limitation)

**Example:**
```json
{
  "options": {
    "reasoningEffort": "high"
  }
}
```

### reasoningSummary

Controls reasoning summary verbosity.

**Values:**
- `auto` - Automatically adapts (default)
- `detailed` - Verbose summaries

**Example:**
```json
{
  "options": {
    "reasoningSummary": "detailed"
  }
}
```

### textVerbosity

Controls output length.

**GPT-5 Values:**
- `low` - Concise
- `medium` - Balanced (default)
- `high` - Verbose

**GPT-5-Codex:**
- `medium` only (API limitation)

**Example:**
```json
{
  "options": {
    "textVerbosity": "high"
  }
}
```

### include

Array of additional response fields to include.

**Default**: `["reasoning.encrypted_content"]`

**Why needed**: Enables multi-turn conversations with `store: false` (stateless mode)

**Example:**
```json
{
  "options": {
    "include": ["reasoning.encrypted_content"]
  }
}
```

### store

Controls server-side conversation persistence.

**⚠️ Required**: `false` (for AI SDK 2.0.50+ compatibility)

**Values:**
- `false` - Stateless mode (required for Codex API)
- `true` - Server-side storage (not supported by Codex API)

**Why required:**
AI SDK 2.0.50+ automatically uses `item_reference` items when `store: true`. The Codex API requires stateless operation (`store: false`), where references cannot be resolved.

**Example:**
```json
{
  "options": {
    "store": false
  }
}
```

**Note:** The plugin automatically injects this via a `chat.params` hook, but explicit configuration is recommended for clarity.

---

## Configuration Patterns

### Pattern 1: Global Options

Apply same settings to all models:

```json
{
  "plugin": ["opencode-openai-codex-auth"],
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

**Use when**: You want consistent behavior across all models.

### Pattern 2: Per-Model Options

Different settings for different models:

```json
{
  "plugin": ["opencode-openai-codex-auth"],
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "store": false
      },
      "models": {
        "gpt-5-codex-fast": {
          "name": "Fast Codex",
          "options": {
            "reasoningEffort": "low",
            "store": false
          }
        },
        "gpt-5-codex-smart": {
          "name": "Smart Codex",
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "store": false
          }
        }
      }
    }
  }
}
```

**Use when**: You want quick-switch presets for different tasks.

**Precedence**: Model options override global options.

### Pattern 3: Config Key vs Name

**Understanding the fields:**

```json
{
  "models": {
    "my-custom-id": {           // ← Config key (used everywhere)
      "name": "My Display Name",  // ← Shows in TUI
      "options": { ... }
    }
  }
}
```

- **Config key** (`my-custom-id`): Used in CLI, config lookups, TUI persistence
- **`name` field**: Friendly display name in model selector
- **`id` field**: DEPRECATED - not used by OpenAI provider

**Example Usage:**
```bash
# Use the config key in CLI
opencode run "task" --model=openai/my-custom-id

# TUI shows: "My Display Name"
```

See [development/CONFIG_FIELDS.md](development/CONFIG_FIELDS.md) for complete explanation.

---

## Advanced Scenarios

### Scenario: Quick Switch Presets

Create named variants for common tasks:

```json
{
  "models": {
    "codex-quick": {
      "name": "⚡ Quick Code",
      "options": {
        "reasoningEffort": "low",
        "store": false
      }
    },
    "codex-balanced": {
      "name": "⚖️ Balanced Code",
      "options": {
        "reasoningEffort": "medium",
        "store": false
      }
    },
    "codex-quality": {
      "name": "🎯 Max Quality",
      "options": {
        "reasoningEffort": "high",
        "reasoningSummary": "detailed",
        "store": false
      }
    }
  }
}
```

### Scenario: Per-Agent Models

Different agents use different models:

```json
{
  "agent": {
    "commit": {
      "model": "openai/codex-quick",
      "prompt": "Generate concise commit messages"
    },
    "review": {
      "model": "openai/codex-quality",
      "prompt": "Thorough code review"
    }
  }
}
```

### Scenario: Project-Specific Overrides

Global config has defaults, project overrides for specific work:

**~/.config/opencode/opencode.json** (global):
```json
{
  "plugin": ["opencode-openai-codex-auth"],
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "store": false
      }
    }
  }
}
```

**my-project/.opencode.json** (project):
```json
{
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "high",
        "store": false
      }
    }
  }
}
```

Result: Project uses `high`, other projects use `medium`.

---

## Plugin Configuration

Advanced plugin settings in `~/.opencode/openai-codex-auth-config.json`:

```json
{
  "codexMode": true
}
```

### CODEX_MODE

**What it does:**
- `true` (default): Uses Codex-OpenCode bridge prompt (Task tool & MCP aware)
- `false`: Uses legacy tool remap message

**When to disable:**
- Compatibility issues with OpenCode updates
- Testing different prompt styles
- Debugging tool call issues

**Override with environment variable:**
```bash
CODEX_MODE=0 opencode run "task"  # Temporarily disable
CODEX_MODE=1 opencode run "task"  # Temporarily enable
```

---

## Configuration Files

**Provided Examples:**
- [config/full-opencode.json](../config/full-opencode.json) - Complete with 9 variants
- [config/minimal-opencode.json](../config/minimal-opencode.json) - Minimal setup

**Your Configs:**
- `~/.config/opencode/opencode.json` - Global config
- `<project>/.opencode.json` - Project-specific config
- `~/.opencode/openai-codex-auth-config.json` - Plugin config

---

## Validation

### Check Config is Valid

```bash
# OpenCode will show errors if config is invalid
opencode
```

### Verify Model Resolution

```bash
# Enable debug logging
DEBUG_CODEX_PLUGIN=1 opencode run "test" --model=openai/your-model-name
```

Look for:
```
[openai-codex-plugin] Model config lookup: "your-model-name" → normalized to "gpt-5-codex" for API {
  hasModelSpecificConfig: true,
  resolvedConfig: { ... }
}
```

### Test Per-Model Options

```bash
# Run with different models, check logs show different options
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5-codex-low
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5-codex-high

# Compare reasoning.effort in logs
cat ~/.opencode/logs/codex-plugin/request-*-after-transform.json | jq '.reasoning.effort'
```

---

## Migration Guide

### From Old Config Names

Old verbose names still work:

```json
{
  "models": {
    "GPT 5 Codex Low (ChatGPT Subscription)": {
      "id": "gpt-5-codex",
      "options": { "reasoningEffort": "low" }
    }
  }
}
```

**Recommended update** (cleaner CLI usage):

```json
{
  "models": {
    "gpt-5-codex-low": {
      "name": "GPT 5 Codex Low (OAuth)",
      "options": {
        "reasoningEffort": "low",
        "store": false
      }
    }
  }
}
```

**Benefits:**
- Cleaner: `--model=openai/gpt-5-codex-low`
- Matches Codex CLI preset names
- No redundant `id` field

---

## Common Patterns

### Pattern: Task-Based Presets

```json
{
  "models": {
    "quick-chat": {
      "name": "Quick Chat",
      "options": {
        "reasoningEffort": "minimal",
        "textVerbosity": "low",
        "store": false
      }
    },
    "code-gen": {
      "name": "Code Generation",
      "options": {
        "reasoningEffort": "medium",
        "store": false
      }
    },
    "debug-help": {
      "name": "Debug Analysis",
      "options": {
        "reasoningEffort": "high",
        "reasoningSummary": "detailed",
        "store": false
      }
    }
  }
}
```

### Pattern: Cost vs Quality

```json
{
  "models": {
    "economy": {
      "name": "Economy Mode",
      "options": {
        "reasoningEffort": "low",
        "textVerbosity": "low",
        "store": false
      }
    },
    "premium": {
      "name": "Premium Mode",
      "options": {
        "reasoningEffort": "high",
        "textVerbosity": "high",
        "store": false
      }
    }
  }
}
```

---

## Troubleshooting Config

### Model Not Found

**Error**: `Model 'openai/my-model' not found`

**Cause**: Config key doesn't match model name in command

**Fix**: Use exact config key:
```json
{ "models": { "my-model": { ... } } }
```
```bash
opencode run "test" --model=openai/my-model  # Must match exactly
```

### Per-Model Options Not Applied

**Check**: Is config key used for lookup?

```bash
DEBUG_CODEX_PLUGIN=1 opencode run "test" --model=openai/your-model
```

Look for `hasModelSpecificConfig: true` in debug output.

### Options Ignored

**Cause**: Model normalizes before lookup

**Example Problem:**
```json
{ "models": { "gpt-5-codex": { "options": { ... } } } }
```
```bash
--model=openai/gpt-5-codex-low  # Normalizes to "gpt-5-codex" before lookup
```

**Fix**: Use exact name you specify in CLI as config key.

---

**Next**: [Troubleshooting](troubleshooting.md) | [Back to Documentation Home](index.md)
