# OpenAI ChatGPT OAuth Plugin for opencode

[![npm version](https://img.shields.io/npm/v/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)
[![npm downloads](https://img.shields.io/npm/dm/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)

This plugin enables opencode to use OpenAI's Codex backend via ChatGPT Plus/Pro OAuth authentication, allowing you to use your ChatGPT subscription instead of OpenAI Platform API credits.

> **Found this useful?** 
Follow me on [X @nummanthinks](https://x.com/nummanthinks) for future updates and more projects!

## Features

- ✅ ChatGPT Plus/Pro OAuth authentication
- ✅ **Zero external dependencies** - Lightweight with only @openauthjs/openauth
- ✅ **Auto-refreshing tokens** - Handles token expiration automatically
- ✅ **Smart auto-updating Codex instructions** - Tracks latest stable release with ETag caching
- ✅ Full tool support (write, edit, bash, grep, etc.)
- ✅ Automatic tool remapping (Codex tools → opencode tools)
- ✅ Configurable reasoning effort and summaries (defaults: medium/auto)
- ✅ Modular architecture for easy maintenance

## Installation

### Quick Start

**No npm install needed!** opencode automatically installs plugins when you add them to your config.

1. **Add plugin to your opencode configuration**:

   Edit your `opencode.json` file (create it if it doesn't exist):

   **Global config**: `~/.config/opencode/opencode.json`
   **Project config**: `<project>/.opencode.json`

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": [
       "opencode-openai-codex-auth"
     ],
     "model": "openai/gpt-5-codex"
   }
   ```

2. **That's it!** opencode will auto-install the plugin on first run.

   > **Note on Updates**: opencode does NOT automatically update plugins to new versions. To update:
   > - Pin to a specific version: `"opencode-openai-codex-auth@1.0.3"` and change the number when updating
   > - Or clear the plugin cache: `rm -rf ~/.cache/opencode/node_modules/opencode-openai-codex-auth`
   >
   > Check [releases](https://github.com/numman-ali/opencode-openai-codex-auth/releases) for the latest version.

> **New to opencode?** Learn more:
> - [Configuration Guide](https://opencode.ai/docs/config/)
> - [Plugin Documentation](https://opencode.ai/docs/plugins/)

### Alternative: Local Development

For testing or development, you can use a local file path:

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-openai-codex-auth"
  ]
}
```

## Authentication

Login with ChatGPT OAuth:

```bash
opencode auth login
```

Select "OpenAI" and choose:
- **"ChatGPT Plus/Pro (Codex Subscription)"** - Opens browser automatically for OAuth flow

> **Important**: Make sure the official Codex CLI is not running during first login, as both use port 1455 for OAuth callback. After initial authentication, this won't be an issue.

## Usage

```bash
# Use gpt-5-codex with plugin defaults (medium/auto/medium)
opencode run "create a hello world file" --model=openai/gpt-5-codex

# Or use regular gpt-5 via ChatGPT subscription
opencode run "solve this complex problem" --model=openai/gpt-5

# Set as default model in opencode.json
opencode run "build a web app"
```

### Plugin Defaults

When no configuration is specified, the plugin uses these defaults for all GPT-5 models:

```json
{
  "reasoningEffort": "medium",
  "reasoningSummary": "auto",
  "textVerbosity": "medium"
}
```

- **`reasoningEffort: "medium"`** - Balanced computational effort for reasoning
- **`reasoningSummary: "auto"`** - Automatically adapts summary verbosity
- **`textVerbosity: "medium"`** - Balanced output length

These defaults match the official Codex CLI behavior and can be customized (see Configuration below).

## Configuration

You can customize model behavior for both `gpt-5` and `gpt-5-codex` models accessed via ChatGPT subscription.

### Available Settings

⚠️ **Important**: The two models have different supported values. Only use values listed in the tables below to avoid API errors.

#### GPT-5 Model

| Setting | Supported Values | Plugin Default | Description |
|---------|-----------------|----------------|-------------|
| `reasoningEffort` | `minimal`, `low`, `medium`, `high` | **`medium`** | Computational effort for reasoning |
| `reasoningSummary` | `auto`, `detailed` | **`auto`** | Verbosity of reasoning summaries |
| `textVerbosity` | `low`, `medium`, `high` | **`medium`** | Output length and detail level |

#### GPT-5-Codex Model

| Setting | Supported Values | Plugin Default | Description |
|---------|-----------------|----------------|-------------|
| `reasoningEffort` | `minimal`*, `low`, `medium`, `high` | **`medium`** | Computational effort for reasoning |
| `reasoningSummary` | `auto`, `detailed` | **`auto`** | Verbosity of reasoning summaries |
| `textVerbosity` | `medium` only | **`medium`** | Output length (codex only supports medium) |

\* `minimal` is auto-normalized to `low` for gpt-5-codex

#### Shared Settings (Both Models)

| Setting | Values | Plugin Default | Description |
|---------|--------|----------------|-------------|
| `include` | Array of strings | `["reasoning.encrypted_content"]` | Additional response fields (for stateless reasoning) |

### Configuration Examples

#### Global Configuration

Apply the same settings to all GPT-5 models:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth"],
  "model": "openai/gpt-5-codex",
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "high",
        "reasoningSummary": "detailed",
        "textVerbosity": "medium"
      }
    }
  }
}
```

#### Per-Model Configuration

Different settings for different models:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth"],
  "provider": {
    "openai": {
      "models": {
        "gpt-5-codex": {
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium"
          }
        },
        "gpt-5": {
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "low"
          }
        }
      }
    }
  }
}
```

#### Mixed Configuration

Global defaults with per-model overrides:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth"],
  "model": "openai/gpt-5-codex",
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "reasoningSummary": "auto",
        "textVerbosity": "medium"
      },
      "models": {
        "gpt-5-codex": {
          "options": {
            "reasoningSummary": "detailed"
          }
        }
      }
    }
  }
}
```

In this example:
- `gpt-5-codex` uses: `reasoningEffort: "medium"`, `reasoningSummary: "detailed"` (overridden), `textVerbosity: "medium"`
- `gpt-5` uses all global defaults: `reasoningEffort: "medium"`, `reasoningSummary: "auto"`, `textVerbosity: "medium"`

## How It Works

The plugin:

1. **Authentication**: Uses ChatGPT OAuth flow with PKCE for secure authentication
2. **Token Management**: Native token refresh implementation (no external dependencies)
3. **Codex Instructions**: Automatically fetches from the latest stable release of [openai/codex](https://github.com/openai/codex)
   - Tracks latest release tag (not main branch) for stability
   - Uses ETag-based caching for efficient updates (only downloads when content changes)
   - Cached locally in `~/.opencode/cache/`
   - Auto-updates when OpenAI publishes new releases
   - Falls back to bundled version if GitHub is unavailable
4. **Request Transformation**: Routes requests to `https://chatgpt.com/backend-api/codex/responses`
5. **Model Normalization**: Maps all model names to `gpt-5-codex` (the Codex backend model)
6. **Tool Remapping**: Injects instructions to map Codex tools to opencode tools:
   - `apply_patch` → `edit`
   - `update_plan` → `todowrite`
7. **Reasoning Configuration**: Defaults to medium effort and auto summaries (configurable per-model)
8. **Encrypted Reasoning**: Includes encrypted reasoning content for stateless multi-turn conversations
9. **History Filtering**: Removes stored conversation IDs since Codex uses `store: false`

## Limitations

- **ChatGPT Plus/Pro required**: Must have an active ChatGPT Plus or Pro subscription

## Troubleshooting

### Authentication Issues

- Ensure you have an active ChatGPT Plus or Pro subscription
- Try re-logging in with `opencode auth login`
- Check browser console during OAuth flow if auto-login fails

### Tool Execution Issues

- Verify plugin is loaded in `opencode.json`
- Check that model is set to `openai/gpt-5-codex`
- Check `~/.opencode/cache/` for cached instructions (auto-downloads from GitHub)

### Request Errors

- **401 Unauthorized**: Token expired, run `opencode auth login` again
- **400 Bad Request**: Check console output for specific error details
- **403 Forbidden**: Subscription may be expired or invalid

### Plugin Issues

If you encounter issues with the latest version, you can pin to a specific stable release:

```json
{
  "plugin": [
    "opencode-openai-codex-auth@1.0.2"
  ]
}
```

Check [releases](https://github.com/numman-ali/opencode-openai-codex-auth/releases) for available versions and their release notes.

## Debugging

### Enable Request Logging

For debugging purposes, you can enable detailed request logging to inspect what's being sent to the Codex API:

```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "your prompt"
```

Logs are saved to `~/.opencode/logs/codex-plugin/` with detailed information about:
- Original request from opencode
- Transformed request sent to Codex
- Response status and headers
- Error details (if any)

Each request generates 3-4 JSON files:
- `request-N-before-transform.json` - Original request
- `request-N-after-transform.json` - Transformed request
- `request-N-response.json` - Response metadata
- `request-N-error-response.json` - Error details (if failed)

**Note**: Logging is disabled by default to avoid cluttering your disk. Only enable it when debugging issues.

## Project Structure

```
opencode-openai-codex-auth/
├── index.mjs                    # Main plugin entry point
├── lib/
│   ├── auth.mjs                # OAuth authentication logic
│   ├── codex.mjs               # Codex instructions & tool remapping
│   ├── server.mjs              # Local OAuth callback server
│   ├── logger.mjs              # Request logging (debug mode)
│   ├── request-transformer.mjs # Request body transformations
│   └── response-handler.mjs    # SSE to JSON conversion
├── package.json
├── README.md
└── LICENSE
```

### Module Overview

- **index.mjs**: Main plugin export and request orchestration
- **lib/auth.mjs**: OAuth flow, PKCE, token exchange, JWT decoding
- **lib/codex.mjs**: Fetches/caches Codex instructions from GitHub, tool remapping
- **lib/server.mjs**: Local HTTP server for OAuth callback handling
- **lib/logger.mjs**: Debug logging functionality (controlled by environment variable)
- **lib/request-transformer.mjs**: Request body transformations (model normalization, tool remapping, reasoning config)
- **lib/response-handler.mjs**: Response handling (SSE to JSON conversion for generateText())

## Credits

Based on research and working implementations from:
- [ben-vargas/ai-sdk-provider-chatgpt-oauth](https://github.com/ben-vargas/ai-sdk-provider-chatgpt-oauth)
- [ben-vargas/ai-opencode-chatgpt-auth](https://github.com/ben-vargas/ai-opencode-chatgpt-auth)
- [openai/codex](https://github.com/openai/codex) OAuth flow
- [sst/opencode](https://github.com/sst/opencode)

## License

MIT
