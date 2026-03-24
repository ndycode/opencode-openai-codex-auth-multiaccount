# OpenCode Config Flow

This document describes the current config surfaces used by `oc-chatgpt-multi-auth` on `main`.

## Primary Config Surfaces

### Global OpenCode config

The installer writes and updates:

```text
~/.config/opencode/opencode.json
```

That file is the primary global config surface used by the shipped install flow in this repository.

### Project override

Project-specific overrides can live in:

```text
<project>/.opencode.json
```

Use that when you want per-project model or provider overrides without changing the global install.

### One-shot overrides

OpenCode can also accept override content at process start:

```bash
OPENCODE_CONFIG=/path/to/config.json opencode
OPENCODE_CONFIG_CONTENT='{"model":"openai/gpt-5.4"}' opencode
```

### Plugin runtime config

Plugin-specific runtime settings live outside the OpenCode config file:

```text
~/.opencode/openai-codex-auth-config.json
```

That file controls plugin behavior such as retry policy, beginner safe mode, fallback policy, TUI output, and per-project account storage.

## Installer Flow

`scripts/install-opencode-codex-auth.js` performs these steps:

1. Load the selected template set (`full` by default, `config/opencode-modern.json` with `--modern`, `config/opencode-legacy.json` with `--legacy`).
2. Back up an existing `~/.config/opencode/opencode.json`.
3. Normalize the plugin list so it ends with plain `oc-chatgpt-multi-auth`.
4. Replace `provider.openai` with the selected shipped template block.
5. Clear the cached OpenCode plugin copy under `~/.cache/opencode/`.

Important detail:

- The installer intentionally writes the plugin entry as `oc-chatgpt-multi-auth`, not `oc-chatgpt-multi-auth@latest`.
- The default `full` install mode merges the modern base-model template with the explicit legacy preset entries so users can access `--variant` workflows and still see the full shipped preset catalog directly.

## Shipped Template Structure

### Modern template

`config/opencode-modern.json` is the compact variant-based template for OpenCode `v1.0.210+`.

It currently ships:

- 9 base model families
- 34 total variants
- `gpt-5.4` and `gpt-5.4-pro` at 1,050,000 context / 128,000 output
- `gpt-5.4-mini`, `gpt-5.4-nano`, and Codex families at 400,000 context / 128,000 output
- `gpt-5.1` at 272,000 context / 128,000 output
- `store: false` plus `include: ["reasoning.encrypted_content"]`

### Full installer mode

The default installer mode combines:

- the 9 modern base model entries from `config/opencode-modern.json`
- the 34 explicit preset entries from `config/opencode-legacy.json`

That hybrid install mode is what fixes the "only 9 models" complaint without removing `--variant` support.

Example shape:

```json
{
  "plugin": ["oc-chatgpt-multi-auth"],
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
        "gpt-5.4": {
          "name": "GPT 5.4 (OAuth)",
          "variants": {
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" }
          }
        }
      }
    }
  }
}
```

Modern OpenCode selection uses:

```bash
opencode run "task" --model=openai/gpt-5.4 --variant=high
```

### Legacy template

`config/opencode-legacy.json` is for OpenCode `v1.0.209` and earlier.

It currently ships:

- 34 explicit model entries
- separate model IDs such as `gpt-5.4-high` and `gpt-5.4-mini-xhigh`
- the same OpenAI provider defaults (`store: false`, `reasoning.encrypted_content`)

Legacy OpenCode selection uses:

```bash
opencode run "task" --model=openai/gpt-5.4-high
```

## Runtime Resolution

At runtime, OpenCode passes `provider.openai.options` and `provider.openai.models` into the plugin loader. The plugin then:

1. Reads global provider options.
2. Reads per-model definitions.
3. Applies request-shaping behavior (`native` by default, `legacy` when explicitly enabled).
4. Normalizes selected model IDs to canonical upstream Codex/ChatGPT model families before the final API call.

Examples:

- `openai/gpt-5.4` stays `gpt-5.4`
- `openai/gpt-5.4-mini-xhigh` normalizes to `gpt-5.4-mini`
- legacy aliases such as `gpt-5-mini` normalize to `gpt-5.4`

## Verification

Use these commands when checking the effective config:

```bash
opencode debug config
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "ping" --model=openai/gpt-5.4
```

Important runtime behavior:

- `opencode debug config` shows merged provider models from your config.
- `opencode models openai` currently shows OpenCode's built-in provider catalog only.
- Because of that, config-defined entries such as `gpt-5.4-mini` can appear in `opencode debug config` while being omitted from `opencode models openai`.

## File Locations

| Path | Purpose |
|------|---------|
| `~/.config/opencode/opencode.json` | global OpenCode config used by the installer |
| `<project>/.opencode.json` | project-local OpenCode override |
| `~/.opencode/openai-codex-auth-config.json` | plugin runtime config |
| `~/.opencode/auth/openai.json` | OAuth token storage |
| `~/.opencode/openai-codex-accounts.json` | global account storage |
| `~/.opencode/projects/<project-key>/openai-codex-accounts.json` | per-project account storage |
| `~/.opencode/logs/codex-plugin/` | plugin request/debug logs |

## See Also

- [CONFIG_FIELDS.md](./CONFIG_FIELDS.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [../../config/README.md](../../config/README.md)
