# FAQ

## What is this project?

`oc-chatgpt-multi-auth` is an OpenCode plugin that lets you sign in with ChatGPT Plus/Pro through OAuth and use GPT-5/Codex model presets from OpenCode.

## Who is it for?

It is aimed at individual developers who use OpenCode and want ChatGPT-backed GPT-5 or Codex workflows for personal development.

## When should I use this instead of the OpenAI Platform API?

Use this plugin when you want a personal OpenCode workflow with your ChatGPT subscription. Use the OpenAI Platform API when you are building production software, shared services, or anything that needs explicit API billing and service terms.

## Do I need ChatGPT Plus or Pro?

Yes. The plugin depends on ChatGPT OAuth access and the model/workspace entitlements attached to your ChatGPT account.

## Which OpenCode versions are supported?

- OpenCode `v1.0.210+`: use the modern template with model variants
- OpenCode `v1.0.209` and earlier: use the legacy template with explicit model entries

See [config/README.md](../config/README.md) for the template split.

## What models are included by default?

The shipped templates focus on current GPT-5 and Codex families such as `gpt-5.4`, `gpt-5-codex`, and `gpt-5.1-*`. Optional or entitlement-gated model IDs can be added manually when your workspace supports them.

## Can I use multiple accounts?

Yes. The plugin supports multiple ChatGPT accounts, health-aware rotation, per-project storage, and guided account management commands.

## Where does it store data?

Tokens, account state, and cache files are stored locally on your machine. See [Privacy & Data Handling](privacy.md) for the exact paths.

## What should I do if authentication fails?

Start with [Troubleshooting](troubleshooting.md), rerun `opencode auth login`, and check whether another process is already using port `1455`.

## I used the old package name. What changed?

The package was renamed from `opencode-openai-codex-auth-multi` to `oc-chatgpt-multi-auth`. If you still reference the old name in your OpenCode config, replace it with `oc-chatgpt-multi-auth@latest`.
