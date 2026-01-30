# changelog

all notable changes to this project. dates are ISO format (YYYY-MM-DD).

## [4.12.0] - 2026-01-30

### breaking

- **tool rename**: all `openai-accounts-*` tools renamed to shorter `codex-*` prefix:
  - `openai-accounts` → `codex-list`
  - `openai-accounts-switch` → `codex-switch`
  - `openai-accounts-status` → `codex-status`
  - `openai-accounts-health` → `codex-health`
  - `openai-accounts-refresh` → `codex-refresh`
  - `openai-accounts-remove` → `codex-remove`

### added

- **codex-export**: export all accounts to a portable JSON file for backup or migration
- **codex-import**: import accounts from a JSON file, merges with existing accounts (skips duplicates)

## [4.11.2] - 2026-01-30

### fixed

- **windows account persistence**: fixed silent failure when saving accounts on Windows. errors are now logged at WARN level with storage path in message, and a toast notification appears if persistence fails.

## [4.10.0] - 2026-01-29

### added
- **per-project accounts**: each project gets its own account storage now. no more conflicts when working across different repos with different chatgpt accounts. auto-detects project directories (looks for .git, package.json, etc). falls back to global storage if you're not in a project folder.
- **configurable toast duration**: rate limit notifications stick around longer now (5s default). set `toastDurationMs` in config if you want them longer/shorter.
- **account removal tool**: new `openai-accounts-remove` tool to delete accounts by index. finally.
- **token masking in logs**: all tokens, api keys, and bearer headers are now masked in debug logs. no more accidentally leaking creds.

### changed
- **account limit bumped to 20**: was 10, now 20. add more accounts if you need them.
- **per-project accounts default on**: `perProjectAccounts` defaults to `true` now. disable with `perProjectAccounts: false` in config if you want the old global behavior.

### fixed
- **token refresh race condition**: added `tokenRotationMap` to prevent concurrent refresh requests from stepping on each other.
- **rate limit retry jitter**: 20% jitter on retry delays to prevent thundering herd.
- **apply_patch infinite loop**: removed apply_patch references from codex bridge that caused loops in some edge cases.

### config
new options in `~/.opencode/openai-codex-auth-config.json`:
```json
{
  "perProjectAccounts": true,
  "toastDurationMs": 5000
}
```

env vars:
- `CODEX_AUTH_PER_PROJECT_ACCOUNTS=1` - enable per-project accounts
- `CODEX_AUTH_TOAST_DURATION_MS=8000` - set toast duration in ms

## [4.9.7] - 2026-01-29

### fixed
- business/team workspace selection: detect multiple workspace account IDs from oauth tokens and prompt for the correct one.
- prevent refresh/hydration from overwriting selected workspace ids (org/manual choices remain stable).
- persist workspace labels and sources for clearer account listings.

### added
- `CODEX_AUTH_ACCOUNT_ID` override to force a specific workspace id (non-interactive login).
- troubleshooting guidance for "usage not included in your plan".

## [4.9.0] - 2026-01-26

**breaking: package renamed from `opencode-openai-codex-auth-multi` to `oc-chatgpt-multi-auth`**

### changed
- **package renamed** to bypass opencode's plugin blocking. opencode skips any plugin with `opencode-openai-codex-auth` in the name. the new name `oc-chatgpt-multi-auth` works correctly.
- updated all documentation, configs, and references to use new package name.
- added `multiAccount` flag check in loader to coexist with opencode's built-in auth.

### fixed
- removed debug console.log statements from loader.
- plugin now properly detects when it should handle auth vs deferring to built-in.

### migration
update your `~/.config/opencode/opencode.json`:
```json
{
  "plugin": ["oc-chatgpt-multi-auth@latest"]
}
```

## [4.8.2] - 2026-01-25

### changed
- fix node esm plugin load by importing tool from `@opencode-ai/plugin/tool` and ensuring runtime dependency is installed.
- correct package metadata (repository links, update-check package name) and add troubleshooting guidance for plugin install/load.

## [4.7.0] - 2026-01-25

**feature release**: full session recovery system ported from opencode-antigravity-auth.

### added
- **session recovery system**: automatic recovery from common api errors that would previously crash sessions:
  - `tool_result_missing`: handles interrupted tool executions (esc during tool run)
  - `thinking_block_order`: fixes corrupted thinking blocks in message history
  - `thinking_disabled_violation`: strips thinking blocks when switching to non-thinking models
- **new recovery module** (`lib/recovery/`):
  - `types.ts` - type definitions for stored messages, parts, and recovery
  - `constants.ts` - storage paths (xdg-compliant) and type sets
  - `storage.ts` - filesystem operations for reading/writing opencode session data
  - `index.ts` - module re-exports
- **main recovery logic** (`lib/recovery.ts`):
  - `detectErrorType()` - identifies recoverable error patterns from api responses
  - `isRecoverableError()` - quick check for recovery eligibility
  - `createSessionRecoveryHook()` - creates hook for session-level error recovery
  - toast notifications during recovery attempts
- **new configuration options**:
  - `sessionRecovery` (default: `true`) - enable/disable session recovery
  - `autoResume` (default: `true`) - auto-resume session after thinking block recovery
  - environment variables: `CODEX_AUTH_SESSION_RECOVERY`, `CODEX_AUTH_AUTO_RESUME`
- **26 new unit tests** for recovery system

### changed
- **account label format**: changed from `Account N (email)` to `N. email` for cleaner display
- **error response handling**: `handleErrorResponse()` now returns `errorBody` for recovery detection
- enhanced error logging with recoverable error detection in fetch flow

## [4.6.0] - 2026-01-25

**feature release**: context overflow handling and missing tool result injection.

### added
- **context overflow handler**: gracefully handles "prompt too long" / context length exceeded errors:
  - returns synthetic sse response with helpful instructions instead of raw 400 error
  - suggests `/compact`, `/clear`, or `/undo` commands to reduce context size
  - prevents opencode session from getting locked on context overflow
  - new module: `lib/context-overflow.ts`
- **missing tool result injection**: automatically handles cancelled tool calls (esc mid-execution):
  - detects orphaned `function_call` items (calls without matching outputs)
  - injects synthetic output: `"Operation cancelled by user"`
  - prevents "missing tool_result" api errors when user cancels mid-tool
  - new function: `injectMissingToolOutputs()` in `lib/request/helpers/input-utils.ts`
- **34 new unit tests** for context overflow and tool injection

## [4.5.0] - 2026-01-24

### added
- **strict tool validation**: automatically cleans tool schemas for compatibility with strict models (claude, gemini)
- **auto-update notifications**: get notified when a new version is available
- **22 model presets**: full variant system with reasoning levels (none/low/medium/high/xhigh)

### changed
- health-aware account rotation with automatic failover
- hybrid selection prefers healthy accounts with available tokens

## [4.4.0] - 2026-01-23

### added
- **health scoring**: tracks success/failure per account
- **token bucket**: prevents hitting rate limits
- **always retries** when all accounts are rate-limited (waits for reset)

### config
new retry options:
- `retryAllAccountsRateLimited` (default: `true`)
- `retryAllAccountsMaxWaitMs` (default: `0` = unlimited)
- `retryAllAccountsMaxRetries` (default: `Infinity`)
