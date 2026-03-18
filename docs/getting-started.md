# Getting Started

This guide covers the full installation and first-run flow for `oc-chatgpt-multi-auth`.

## Before You Begin

> [!CAUTION]
> This plugin is for personal development use with your own ChatGPT Plus/Pro subscription.
>
> - It is not intended for commercial resale, shared multi-user access, or production services.
> - It uses official OAuth authentication, but it is an independent open-source project and is not affiliated with OpenAI.
> - For production applications, use the [OpenAI Platform API](https://platform.openai.com/).

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| OpenCode | Install from [opencode.ai](https://opencode.ai) |
| ChatGPT Plus or Pro | Required for OAuth access and model entitlements |
| Node.js 20+ | Needed for local OpenCode runtime and plugin installation |

## Fastest Install Path

```bash
npx -y oc-chatgpt-multi-auth@latest
opencode auth login
opencode run "Explain this repository" --model=openai/gpt-5.4 --variant=medium
```

The installer updates `~/.config/opencode/opencode.json`, backs up the previous config, normalizes the plugin entry to `oc-chatgpt-multi-auth`, and clears the cached plugin copy so OpenCode reinstalls the latest package.

If you are on OpenCode `v1.0.209` or earlier, use:

```bash
npx -y oc-chatgpt-multi-auth@latest --legacy
```

## Install from Source

Use this only when you want to develop or test the plugin locally.

```bash
git clone https://github.com/ndycode/oc-chatgpt-multi-auth.git
cd oc-chatgpt-multi-auth
npm ci
npm run build
```

Point OpenCode at the built plugin:

```json
{
  "plugin": ["file:///absolute/path/to/oc-chatgpt-multi-auth/dist"]
}
```

Use the built `dist/` directory, not the repository root.

## Authentication

Run:

```bash
opencode auth login
```

Then choose:

1. `OpenAI`
2. `ChatGPT Plus/Pro (Codex Subscription)`

The browser-based OAuth flow uses the same local callback port as Codex CLI: `http://127.0.0.1:1455/auth/callback`.

### Remote or Headless Login

If you are on SSH, WSL, or another environment where the browser callback flow is inconvenient:

1. rerun `opencode auth login`
2. choose `ChatGPT Plus/Pro (Manual URL Paste)`
3. paste the full redirect URL after login completes in the browser

## Add the Plugin to OpenCode

If you are not using the installer, edit `~/.config/opencode/opencode.json` manually:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["oc-chatgpt-multi-auth"]
}
```

## Choose a Config Template

The repository ships two supported templates:

| OpenCode version | Template |
|------------------|----------|
| `v1.0.210+` | [`config/opencode-modern.json`](../config/opencode-modern.json) |
| `v1.0.209` and earlier | [`config/opencode-legacy.json`](../config/opencode-legacy.json) |

The templates include the supported GPT-5/Codex families, required `store: false` handling, and `reasoning.encrypted_content` for multi-turn sessions.
Current templates expose 7 shipped base model families and 26 shipped presets overall (26 modern variants or 26 legacy explicit entries), including `gpt-5.4-mini`.

Optional model IDs such as `gpt-5.4-pro` or entitlement-gated Spark variants should be added manually only when your workspace supports them.

## Verify the Setup

Run one of these commands:

```bash
# Modern OpenCode
opencode run "Create a short TODO list for this repo" --model=openai/gpt-5.4 --variant=medium
opencode run "Inspect the retry logic and summarize it" --model=openai/gpt-5-codex --variant=high

# Legacy OpenCode
opencode run "Create a short TODO list for this repo" --model=openai/gpt-5.4-medium
```

If you want to verify request routing, run a request with logging enabled:

```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5.4
```

The first request should create logs under `~/.opencode/logs/codex-plugin/`.

Use `opencode debug config` when you want to verify that template-defined or custom models were merged into your effective config. `opencode models openai` currently shows OpenCode's built-in provider catalog and can omit config-defined entries such as `gpt-5.4-mini`.

## Multi-Account Setup

The plugin can manage multiple ChatGPT accounts and choose the healthiest account or workspace for each request.

After your first successful login, you can add more accounts by running `opencode auth login` again or by using the guided commands below.

## Guided Onboarding Commands

These commands are useful after installation:

```text
codex-setup
codex-help topic="setup"
codex-doctor
codex-next
```

Notes:

- `codex-switch`, `codex-label`, and `codex-remove` can show interactive account pickers when `index` is omitted in a supported terminal.
- The plugin can show a startup preflight summary with the current account health state and suggested next step.

## Beginner Safe Mode

If you want conservative retry behavior while learning the workflow, enable beginner safe mode:

```json
{
  "beginnerSafeMode": true
}
```

Or via environment variable:

```bash
CODEX_AUTH_BEGINNER_SAFE_MODE=1 opencode
```

This mode forces a more conservative retry profile and reduces the chance of long retry loops while you are debugging setup issues.

## Update the Plugin

From npm:

```bash
npx -y oc-chatgpt-multi-auth@latest
```

From a local clone:

```bash
git pull
npm ci
npm run build
```

## Next Reading

- [Configuration Reference](configuration.md)
- [Troubleshooting](troubleshooting.md)
- [FAQ](faq.md)
- [Privacy & Data Handling](privacy.md)
