# Configuration Guide

Complete reference for configuring the OpenCode OpenAI Codex Auth Plugin.

---

## Quick Reference

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
      }
    }
  }
}
```

---

## Configuration Options

### reasoningEffort

Controls computational effort for reasoning.

| Model | Supported Values |
|-------|------------------|
| `gpt-5.2` | none, low, medium, high, xhigh |
| `gpt-5.2-codex` | low, medium, high, xhigh |
| `gpt-5.1-codex-max` | low, medium, high, xhigh |
| `gpt-5.1-codex` | low, medium, high |
| `gpt-5.1-codex-mini` | medium, high |
| `gpt-5.1` | none, low, medium, high |

<details>
<summary><b>Value Descriptions</b></summary>

| Value | Description |
|-------|-------------|
| `none` | No dedicated reasoning phase (GPT-5.2/5.1 base only) |
| `low` | Light reasoning, fastest |
| `medium` | Balanced (default) |
| `high` | Deep reasoning |
| `xhigh` | Extra depth for complex tasks (GPT-5.2, 5.2-codex, codex-max) |

**Notes:**
- `none` auto-converts to `low` for Codex variants
- `xhigh` downgrades to `high` on models that don't support it
- Codex Mini only supports `medium` or `high`

</details>

### reasoningSummary

Controls reasoning summary verbosity.

| Value | Description |
|-------|-------------|
| `auto` | Automatically adapts (default) |
| `concise` | Short summaries |
| `detailed` | Verbose summaries |
| `off` | Disable summary (Codex Max) |
| `on` | Force enable (Codex Max) |

### textVerbosity

Controls output length.

| Value | Description |
|-------|-------------|
| `low` | Concise responses |
| `medium` | Balanced (default) |
| `high` | Verbose responses |

### include

Array of additional response fields to include.

| Value | Purpose |
|-------|---------|
| `reasoning.encrypted_content` | Enables multi-turn with `store: false` |

**Required** for multi-turn conversations in stateless mode.

### store

Controls server-side conversation persistence.

| Value | Description |
|-------|-------------|
| `false` | Stateless mode (required) |
| `true` | Not supported by Codex API |

> **Important**: Must be `false` for AI SDK 2.0.50+ compatibility.

---

## Configuration Patterns

<details open>
<summary><b>Pattern 1: Global Options</b></summary>

Apply same settings to all models:

```json
{
  "plugin": ["opencode-openai-codex-auth-multi@latest"],
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

</details>

<details>
<summary><b>Pattern 2: Per-Model Options</b></summary>

Different settings for different models:

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
          "name": "Fast GPT-5.2",
          "options": { "reasoningEffort": "low" }
        },
        "gpt-5.2-smart": {
          "name": "Smart GPT-5.2",
          "options": { "reasoningEffort": "high" }
        }
      }
    }
  }
}
```

**Precedence**: Model options override global options.

</details>

<details>
<summary><b>Pattern 3: Per-Agent Models</b></summary>

Different agents use different models:

```json
{
  "agent": {
    "commit": {
      "model": "openai/gpt-5.1-codex-low",
      "prompt": "Generate concise commit messages"
    },
    "review": {
      "model": "openai/gpt-5.1-codex-high",
      "prompt": "Thorough code review"
    }
  }
}
```

</details>

<details>
<summary><b>Pattern 4: Project-Specific Overrides</b></summary>

**Global** (`~/.config/opencode/opencode.json`):
```json
{
  "plugin": ["opencode-openai-codex-auth-multi@latest"],
  "provider": {
    "openai": {
      "options": { "reasoningEffort": "medium" }
    }
  }
}
```

**Project** (`my-project/.opencode.json`):
```json
{
  "provider": {
    "openai": {
      "options": { "reasoningEffort": "high" }
    }
  }
}
```

Result: Project uses `high`, other projects use `medium`.

</details>

---

## Plugin Configuration

Advanced plugin settings in `~/.opencode/openai-codex-auth-config.json`:

```json
{
  "codexMode": true
}
```

### Options

| Option | Default | What it does |
|--------|---------|--------------|
| `codexMode` | `true` | Uses Codex-OpenCode bridge prompt (synced with Codex CLI) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DEBUG_CODEX_PLUGIN=1` | Enable debug logging |
| `ENABLE_PLUGIN_REQUEST_LOGGING=1` | Log all API requests |
| `CODEX_MODE=0` | Temporarily disable bridge prompt |
| `CODEX_MODE=1` | Temporarily enable bridge prompt |

---

## Configuration Files

### Provided Examples

| File | Use Case |
|------|----------|
| `config/opencode-modern.json` | OpenCode v1.0.210+ (variants) |
| `config/opencode-legacy.json` | OpenCode v1.0.209 and below |

### Your Files

| File | Purpose |
|------|---------|
| `~/.config/opencode/opencode.json` | Global config |
| `<project>/.opencode.json` | Project-specific |
| `~/.opencode/openai-codex-auth-config.json` | Plugin config |
| `~/.opencode/auth/openai.json` | OAuth tokens |
| `~/.opencode/openai-codex-accounts.json` | Multi-account storage |

---

## Validation

### Check Config is Valid

```bash
opencode
# Shows errors if config is invalid
```

### Verify Model Resolution

```bash
DEBUG_CODEX_PLUGIN=1 opencode run "test" --model=openai/gpt-5.2
```

Look for:
```
[openai-codex-plugin] Model config lookup: "gpt-5.2" → normalized to "gpt-5.2-codex" for API {
  hasModelSpecificConfig: true,
  resolvedConfig: { ... }
}
```

### Test Per-Model Options

```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5.2-low
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5.2-high

# Compare reasoning.effort in logs
cat ~/.opencode/logs/codex-plugin/request-*-after-transform.json | jq '.reasoning.effort'
```

---

## Troubleshooting Config

<details>
<summary><b>Model Not Found</b></summary>

**Error**: `Model 'openai/my-model' not found`

**Cause**: Config key doesn't match model name in command

**Fix**: Use exact config key:
```json
{ "models": { "my-model": { ... } } }
```
```bash
opencode run "test" --model=openai/my-model  # Must match exactly
```

</details>

<details>
<summary><b>Per-Model Options Not Applied</b></summary>

**Debug:**
```bash
DEBUG_CODEX_PLUGIN=1 opencode run "test" --model=openai/your-model
```

Look for `hasModelSpecificConfig: true` in output.

**If false**: Config lookup failed. Check:
1. Model name in CLI matches config key
2. No typos in config file
3. Correct config file location

</details>

<details>
<summary><b>Options Ignored</b></summary>

**Cause**: Model normalizes before lookup

**Fix**: Use the official config files (`opencode-modern.json` or `opencode-legacy.json`) instead of custom configs.

</details>

---

**Next**: [Troubleshooting](troubleshooting.md) | [Back to Documentation Home](index.md)
