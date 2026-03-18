# Testing Guide

This guide describes the current validation surface for `oc-chatgpt-multi-auth` on `main`.

## Release-Grade Commands

Run these before opening a PR:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

What they cover:

- `lint`: ESLint for TypeScript sources and `scripts/`
- `typecheck`: `tsc --noEmit`
- `test`: Vitest suite across auth, config, request transformation, storage, UI, recovery, and rotation
- `build`: compile TypeScript and copy `lib/oauth-success.html` into `dist/lib/`

## Current High-Value Test Areas

Representative suites on `main`:

| File / area | Focus |
|------|---------|
| `test/gpt54-models.test.ts` | GPT-5.4 family defaults and model surface |
| `test/request-transformer.test.ts` | model normalization, request shaping, `store: false`, reasoning options |
| `test/config.test.ts` | config loading and provider model handling |
| `test/plugin-config.test.ts` | plugin runtime config defaults and env overrides |
| `test/index.test.ts` | tool registration, beginner flows, account command behavior |
| `test/beginner-ui.test.ts` | checklist, doctor findings, next-action output |
| `test/storage.test.ts` / `test/storage-async.test.ts` | account persistence, backup paths, import/export safety |
| `test/recovery*.test.ts` | recovery storage and resume behavior |
| `test/rotation*.test.ts` / `test/refresh-queue.test.ts` | multi-account rotation, refresh serialization, retry flow |
| `test/auth*.test.ts` / `test/oauth-server.integration.test.ts` | OAuth flow and auth edge cases |
| `test/ui-*.test.ts` | TUI formatting, runtime, theme behavior |

The repository also includes `test/property/` and `test/chaos/` directories for higher-variance regression coverage.

## Documentation-Adjacent Checks

When documentation changes touch setup or config guidance, verify the docs against the live repo surface:

1. Confirm commands exist in `index.ts`.
2. Confirm config examples match `config/opencode-modern.json`, `config/opencode-legacy.json`, and `config/minimal-opencode.json`.
3. Confirm install/update guidance matches `scripts/install-opencode-codex-auth.js`.
4. Confirm repo scripts listed in docs still exist in `package.json`.

Useful commands:

```bash
rg -n "codex-setup|codex-doctor|codex-next|codex-help" index.ts
rg -n "\"build\"|\"typecheck\"|\"lint\"|\"test\"" package.json
```

## Manual Smoke Checks

Use these when a change affects setup, auth flow, or account operations.

### Install + config smoke

```bash
npx -y oc-chatgpt-multi-auth@latest --dry-run
opencode debug config
```

Verify:

- the global config path is `~/.config/opencode/opencode.json`
- the plugin entry resolves to `oc-chatgpt-multi-auth`
- the selected template contributes the expected `provider.openai` block

### Model surface smoke

```bash
opencode debug config
opencode models openai
```

Important note:

- `opencode debug config` shows merged custom/template model entries
- `opencode models openai` currently shows only OpenCode's built-in provider catalog

### Request-path smoke

```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "ping" --model=openai/gpt-5.4
```

Verify:

- log files appear under `~/.opencode/logs/codex-plugin/`
- transformed requests keep `store: false`
- `reasoning.encrypted_content` is included

### Beginner command smoke

Run these in an interactive session:

```text
codex-setup
codex-setup --wizard
codex-doctor
codex-doctor --fix
codex-next
codex-list
```

Verify:

- checklist and wizard output render cleanly
- doctor findings and next-action output remain coherent
- commands that omit `index` degrade gracefully outside interactive TTYs

## Failure Triage

If validation fails, sort the failure first:

| Surface | Typical command |
|------|---------|
| lint/style | `npm run lint` |
| type drift | `npm run typecheck` |
| runtime or transform behavior | `npm test -- request-transformer` |
| account storage / migration | `npm test -- storage` |
| UI command output | `npm test -- index` or `npm test -- beginner-ui` |

For request-path debugging:

```bash
DEBUG_CODEX_PLUGIN=1 ENABLE_PLUGIN_REQUEST_LOGGING=1 CODEX_PLUGIN_LOG_BODIES=1 opencode run "ping" --model=openai/gpt-5.4
```

Use that only when you need payload-level detail because it can log sensitive request and response bodies.

## PR Checklist

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- Manual doc/config spot-check if the PR changes docs, setup, or config templates

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [CONFIG_FLOW.md](./CONFIG_FLOW.md)
- [../../test/README.md](../../test/README.md)
