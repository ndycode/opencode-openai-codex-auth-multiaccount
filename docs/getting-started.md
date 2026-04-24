# Getting Started

This guide covers the full installation and first-run flow for `oc-codex-multi-auth`.

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
npx -y oc-codex-multi-auth@latest
opencode auth login
opencode run "Explain this repository" --model=openai/gpt-5.5-medium
```

The installer updates `~/.config/opencode/opencode.json`, backs up the previous config, normalizes the plugin entry to `oc-codex-multi-auth`, and clears the cached plugin copy so OpenCode reinstalls the latest package.

By default, the installer writes a full catalog config so you get both:
- modern base model entries such as `gpt-5.5` for `--variant` workflows
- explicit preset entries such as `gpt-5.5-medium` / `gpt-5.5-high` so the full shipped catalog is visible directly in pickers

Tested live on OpenCode `1.14.22`: use explicit GPT-5.5 selectors like `openai/gpt-5.5-medium` or `openai/gpt-5.5-high` for real-session verification. Bare `openai/gpt-5.5 --variant=...` may or may not work depending on your OpenCode release.

If you prefer the compact variant-only config on OpenCode `v1.0.210+`, use:

```bash
npx -y oc-codex-multi-auth@latest --modern
```

If you explicitly want the older explicit-only layout, use:

```bash
npx -y oc-codex-multi-auth@latest --legacy
```

## Install from Source

Use this only when you want to develop or test the plugin locally.

```bash
git clone https://github.com/ndycode/oc-codex-multi-auth.git
cd oc-codex-multi-auth
npm ci
npm run build
```

Point OpenCode at the built plugin:

```json
{
  "plugin": ["file:///absolute/path/to/oc-codex-multi-auth/dist"]
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
2. `Codex OAuth (ChatGPT Plus/Pro)`

The browser-based OAuth flow uses the same local callback port as Codex CLI. The authorize redirect is `http://localhost:1455/auth/callback`, while the local callback server binds `http://127.0.0.1:1455/auth/callback` and `[::1]:1455` for dual-stack localhost redirects.

If you authenticated before the connector scopes were added, re-run `opencode auth login`. Current account records persist the granted OAuth scope and accounts missing `api.connectors.read` / `api.connectors.invoke` are marked for re-auth instead of being silently reused.

### Remote or Headless Login

If you are on SSH, WSL, or another environment where the browser callback flow is inconvenient:

1. rerun `opencode auth login`
2. choose `Codex OAuth (Device Code)`
3. open the verification link, enter the one-time code, and wait for login to finish
4. if device code is unavailable on your auth server, fall back to `Codex OAuth (Manual URL Paste)`

## Add the Plugin to OpenCode

If you are not using the installer, edit `~/.config/opencode/opencode.json` manually:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["oc-codex-multi-auth"]
}
```

## Choose a Config Template

The repository ships two supported templates:

| OpenCode version | Template |
|------------------|----------|
| `v1.0.210+` | [`config/opencode-modern.json`](../config/opencode-modern.json) |
| `v1.0.209` and earlier | [`config/opencode-legacy.json`](../config/opencode-legacy.json) |

The templates include the supported GPT-5/Codex families, required `store: false` handling, and `reasoning.encrypted_content` for multi-turn sessions.
Current templates expose 9 shipped base model families and 34 shipped presets overall (34 modern variants or 34 legacy explicit entries).

On OpenCode `v1.0.210+`, the modern template intentionally shows 9 base model entries because the additional presets are selected through `--variant` instead of separate model keys.

`gpt-5.5-pro` ships in the templates but can still be entitlement-gated by your workspace. Add entitlement-gated Spark variants manually only when your workspace supports them.

## Verify the Setup

Run one of these commands:

```bash
# Recommended current GPT-5.5 path
opencode run "Create a short TODO list for this repo" --model=openai/gpt-5.5-medium
opencode run "Inspect the retry logic and summarize it" --model=openai/gpt-5-codex --variant=high

# Compact modern template, only if your OpenCode release exposes bare base entries
opencode run "Create a short TODO list for this repo" --model=openai/gpt-5.5 --variant=medium
```

If you want to verify request routing, run a request with logging enabled:

```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5.5-medium
```

The first request should create logs under `~/.opencode/logs/codex-plugin/`.

Use `opencode debug config` when you want to verify that template-defined or custom models were merged into your effective config. On tested OpenCode `1.14.22`, `opencode models openai` exposes explicit GPT-5.5 entries such as `gpt-5.5-medium` / `gpt-5.5-high`; bare `gpt-5.5` may still not be selectable even when present in config.

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
npx -y oc-codex-multi-auth@latest
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
