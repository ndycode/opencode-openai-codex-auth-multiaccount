# Config Fields

This document summarizes the current config fields that matter for `oc-chatgpt-multi-auth`.

## Top-Level Fields

### `plugin`

Use the plain package name in OpenCode config:

```json
{
  "plugin": ["oc-chatgpt-multi-auth"]
}
```

The installer normalizes to this unpinned value on purpose.

### `model`

Sets the default selected model:

```json
{
  "model": "openai/gpt-5.4"
}
```

Modern OpenCode pairs this with `--variant` at runtime.

## `provider.openai.options`

These are the global defaults the plugin receives for every OpenAI request.

Common fields:

| Field | Purpose |
|------|---------|
| `reasoningEffort` | default reasoning depth |
| `reasoningSummary` | reasoning summary style |
| `textVerbosity` | output verbosity |
| `include` | extra response fields, typically `reasoning.encrypted_content` |
| `store` | must stay `false` for this plugin |

Example:

```json
{
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

## `provider.openai.models`

This field differs slightly between the modern and legacy shipped templates.

### Modern template fields

Modern templates define base model families and expose presets through `variants`.

Example:

```json
{
  "provider": {
    "openai": {
      "models": {
        "gpt-5.4": {
          "name": "GPT 5.4 (OAuth)",
          "limit": {
            "context": 1000000,
            "output": 128000
          },
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          },
          "variants": {
            "none": { "reasoningEffort": "none" },
            "medium": { "reasoningEffort": "medium" },
            "xhigh": { "reasoningEffort": "xhigh" }
          }
        }
      }
    }
  }
}
```

Important fields:

| Field | Purpose |
|------|---------|
| model key (`gpt-5.4`) | base model family exposed to OpenCode |
| `name` | human-readable picker label |
| `limit` | context/output metadata shown to OpenCode |
| `modalities` | allowed input/output types |
| `variants` | reasoning/verbosity presets selected with `--variant` |
| `options` | per-model defaults when needed |

Modern selection example:

```bash
opencode run "task" --model=openai/gpt-5.4-mini --variant=high
```

### Legacy template fields

Legacy templates expose each preset as its own model key.

Example:

```json
{
  "provider": {
    "openai": {
      "models": {
        "gpt-5.4-high": {
          "name": "GPT 5.4 High (OAuth)",
          "limit": {
            "context": 1000000,
            "output": 128000
          },
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        }
      }
    }
  }
}
```

Legacy selection example:

```bash
opencode run "task" --model=openai/gpt-5.4-high
```

## Model Normalization

The plugin normalizes selected model IDs before the upstream API call.

Examples:

| Selected model | Effective upstream family |
|------|---------|
| `openai/gpt-5.4` | `gpt-5.4` |
| `openai/gpt-5.4-mini-xhigh` | `gpt-5.4-mini` |
| `openai/gpt-5.1-codex-high` | `gpt-5.1-codex` |
| `openai/gpt-5-mini` | `gpt-5.4` |
| `openai/gpt-5-nano` | `gpt-5.4` |

This normalization is why legacy aliases and snapshot-like IDs can still route to a stable family while preserving the user-facing config surface.

## Verification Notes

Use these commands when validating config fields:

```bash
opencode debug config
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "ping" --model=openai/gpt-5.4
```

Important behavior:

- `opencode debug config` shows merged config-defined models and variants.
- `opencode models openai` currently shows only the built-in provider catalog.
- Because of that, config-defined entries such as `gpt-5.4-mini` may not appear in `opencode models openai` even when they are active in the effective config.

## Account Metadata Fields

Account storage also includes user-facing metadata fields used by the `codex-*` tools:

| Field | Purpose |
|------|---------|
| `accountLabel` | display label |
| `accountTags` | grouping/filter tags |
| `accountNote` | short reminder text |

These fields are updated by `codex-label`, `codex-tag`, and `codex-note`.

## See Also

- [CONFIG_FLOW.md](./CONFIG_FLOW.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [../../docs/configuration.md](../../configuration.md)
