# OpenAI ChatGPT OAuth Plugin for opencode

[![npm version](https://img.shields.io/npm/v/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)
[![npm downloads](https://img.shields.io/npm/dm/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)

This plugin enables opencode to use OpenAI's Codex backend via ChatGPT Plus/Pro OAuth authentication, allowing you to use your ChatGPT subscription instead of OpenAI Platform API credits.

## Features

- ✅ ChatGPT Plus/Pro OAuth authentication
- ✅ **Zero external dependencies** - Lightweight with only @openauthjs/openauth
- ✅ **Auto-refreshing tokens** - Handles token expiration automatically
- ✅ **Smart auto-updating Codex instructions** - Tracks latest stable release with ETag caching
- ✅ Full tool support (write, edit, bash, grep, etc.)
- ✅ Automatic tool remapping (Codex tools → opencode tools)
- ✅ High reasoning effort with detailed thinking blocks
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
# Use gpt-5-codex with high reasoning (default)
opencode run "create a hello world file" --model=openai/gpt-5-codex

# Or set as default in opencode.json
opencode run "solve this complex algorithm problem"
```

The plugin automatically configures:
- **High reasoning effort** for deep thinking
- **Detailed reasoning summaries** to show thought process
- **Medium text verbosity** for balanced output

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
7. **Reasoning Configuration**: Forces high reasoning effort with detailed summaries
8. **History Filtering**: Removes stored conversation IDs since Codex uses `store: false`

## Limitations

- **ChatGPT Plus/Pro required**: Must have an active ChatGPT Plus or Pro subscription
- **Medium text verbosity**: Codex only supports `medium` for text verbosity

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

## Project Structure

```
opencode-openai-codex-auth/
├── index.mjs              # Main plugin entry point
├── lib/
│   ├── auth.mjs          # OAuth authentication logic
│   ├── codex.mjs         # Codex instructions & tool remapping
│   ├── server.mjs        # Local OAuth callback server
│   └── codex-instructions.md  # Bundled Codex instructions (fallback)
├── package.json
├── README.md
└── LICENSE
```

### Module Overview

- **index.mjs**: Main plugin export and request transformation
- **lib/auth.mjs**: OAuth flow, PKCE, token exchange, JWT decoding
- **lib/codex.mjs**: Fetches/caches Codex instructions from GitHub, tool remapping
- **lib/server.mjs**: Local HTTP server for OAuth callback handling

## Credits

Based on research and working implementations from:
- [ben-vargas/ai-sdk-provider-chatgpt-oauth](https://github.com/ben-vargas/ai-sdk-provider-chatgpt-oauth)
- [ben-vargas/ai-opencode-chatgpt-auth](https://github.com/ben-vargas/ai-opencode-chatgpt-auth)
- [openai/codex](https://github.com/openai/codex) OAuth flow
- [sst/opencode](https://github.com/sst/opencode)

## License

MIT
