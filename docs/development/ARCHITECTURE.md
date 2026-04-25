# Plugin Architecture & Technical Decisions

> Reflects the codebase as of the 2026-04-25 current-structure audit. Individual section version markers refer to the release that introduced a feature and are retained for historical context only.

This document explains the technical design decisions, architecture, and implementation details of the OpenAI Codex OAuth plugin for OpenCode.

## Module Layout (v6.0.0)

```
index.ts              # plugin entry: context wiring + fetch pipeline
lib/
├── accounts/         # state, persistence, rotation, rate-limits, recovery
├── auth/             # OAuth flow, PKCE, callback server
├── prompts/          # Codex bridge + tool-remap prompts, ETag cache
├── recovery/         # session recovery (tool_result_missing, thinking blocks)
├── request/          # transformer, fetch-helpers, response-handler
├── storage/          # atomic writes, migrations, paths, flagged, backup/export/import
├── tools/            # 21 OpenCode tools (codex-list, codex-switch, codex-doctor, ...)
└── ui/               # terminal UI runtime, theme, formatting, beginner checklist
```

The single `index.ts` of earlier releases has been split: account management lives under `lib/accounts/`, storage under `lib/storage/`, and every registered `codex-*` tool is its own file under `lib/tools/`. `index.ts` now holds the plugin loader, request pipeline wiring, context construction, and registry attachment.

## Documentation Layout

The current docs tree mirrors the codebase boundaries above: user docs cover setup and operations, maintainer docs cover internal architecture and validation, and the regenerated audit corpus records point-in-time architecture findings.

```text
docs/
├── index.md                  # docs landing page
├── README.md                 # docs portal navigation
├── DOCUMENTATION.md          # repository documentation map
├── getting-started.md        # install, auth, and first-run guide
├── configuration.md          # public config reference
├── troubleshooting.md        # operational failure modes and fixes
├── faq.md                    # short common answers
├── privacy.md                # local data and upstream request notes
├── OPENCODE_PR_PROPOSAL.md   # upstream OpenCode proposal notes
├── _config.yml               # docs site config
├── development/              # maintainer architecture and validation docs
│   ├── ARCHITECTURE.md
│   ├── CONFIG_FIELDS.md
│   ├── CONFIG_FLOW.md
│   ├── TESTING.md
│   └── TUI_PARITY_CHECKLIST.md
└── audits/                   # current-structure audit corpus
    ├── INDEX.md
    ├── 01-executive-summary.md ... 16-verdict.md
    ├── _findings/            # T01 through T16 detailed findings
    └── _meta/                # audit rubric, ledger, environment, verification
```

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Stateless vs Stateful Mode](#stateless-vs-stateful-mode)
- [Message ID Handling](#message-id-handling)
- [Reasoning Content Flow](#reasoning-content-flow)
- [Request Pipeline](#request-pipeline)
- [Comparison with Codex CLI](#comparison-with-codex-cli)
- [Design Rationale](#design-rationale)
- [TUI Parity Checklist](./TUI_PARITY_CHECKLIST.md)

---

## Architecture Overview

```
┌─────────────┐
│  OpenCode   │  TUI/Desktop client
└──────┬──────┘
       │
       │ streamText() with AI SDK
       │
       ▼
┌──────────────────────────────┐
│  OpenCode Provider System    │
│  - Loads plugin               │
│  - Calls plugin.auth.loader() │
│  - Passes provider config     │
└──────┬───────────────────────┘
       │
       │ Custom fetch()
       │
       ▼
┌──────────────────────────────┐
│  This Plugin                 │
│  - OAuth authentication      │
│  - Request transformation    │
│  - store:false handling      │
│  - Codex bridge prompts      │
└──────┬───────────────────────┘
       │
       │ HTTP POST with OAuth
       │
       ▼
┌──────────────────────────────┐
│  OpenAI Codex API            │
│  (ChatGPT Backend)           │
│  - Requires OAuth            │
│  - Supports store:false      │
│  - Returns SSE stream        │
└──────────────────────────────┘
```

---

## Stateless vs Stateful Mode

### Why store:false?

The plugin uses **`store: false`** (stateless mode) because:

1. **ChatGPT Backend Requirement** (confirmed via testing):
   ```json
   // Attempt with store:true → 400 Bad Request
   {"detail":"Store must be set to false"}
   ```

2. **Codex CLI Behavior** (external Codex CLI `codex-rs/core/src/client.rs`):
   ```rust
   // Codex CLI uses store:false for ChatGPT OAuth
   let azure_workaround = self.provider.is_azure_responses_endpoint();
   store: azure_workaround,  // false for ChatGPT, true for Azure
   ```

**Key Points**:
1. ✅ **ChatGPT backend REQUIRES store:false** (not optional)
2. ✅ **Codex CLI uses store:false for ChatGPT**
3. ✅ **Azure requires store:true** (different endpoint, not supported by this plugin)
4. ✅ **Stateless mode = no server-side conversation storage**

### How Context Works with store:false

**Question**: If there's no server storage, how does the LLM remember previous turns?

**Answer**: Full message history is sent in every request:

```typescript
// Turn 3 request contains ALL previous messages:
input: [
  { role: "developer", content: "..." },      // System prompts
  { role: "user", content: "write test.txt" },     // Turn 1 user
  { type: "function_call", name: "write", ... },   // Turn 1 tool call
  { type: "function_call_output", ... },           // Turn 1 tool result
  { role: "assistant", content: "Done!" },         // Turn 1 response
  { role: "user", content: "read it" },            // Turn 2 user
  { type: "function_call", name: "read", ... },    // Turn 2 tool call
  { type: "function_call_output", ... },           // Turn 2 tool result
  { role: "assistant", content: "Contents..." },   // Turn 2 response
  { role: "user", content: "what did you write?" } // Turn 3 user (current)
]
// Legacy mode strips IDs and item_reference; native mode preserves host payload shape
```

**Context is maintained through**:
- ✅ Full message history (LLM sees all previous messages)
- ✅ Full tool call history (LLM sees what it did)
- ✅ `reasoning.encrypted_content` (preserves reasoning between turns)

**Source**: Verified via `ENABLE_PLUGIN_REQUEST_LOGGING=1 CODEX_PLUGIN_LOG_BODIES=1` logs

### Store Comparison

| Aspect | store:false (This Plugin) | store:true (Azure Only) |
|--------|---------------------------|-------------------------|
| **ChatGPT Support** | ✅ Required | ❌ Rejected by API |
| **Message History** | ✅ Sent in each request (no IDs) | Stored on server |
| **Message IDs** | ❌ Must strip all | ✅ Required |
| **AI SDK Compat** | ✅ Native mode preserves host payload; legacy mode filters unsupported `item_reference` + IDs | ✅ Works natively |
| **Context** | Full history + encrypted reasoning | Server-stored conversation |
| **Codex CLI Parity** | ✅ Perfect match | ❌ Different mode |

**Decision**: Use **`store:false`** (only option for ChatGPT backend).

---

## Message ID Handling & AI SDK Compatibility (Legacy Mode)

> This section documents `requestTransformMode: "legacy"` behavior. Native mode bypasses this rewrite path.

### The Problem

**OpenCode/AI SDK sends two incompatible constructs**:
```typescript
// Multi-turn request from OpenCode
const body = {
  input: [
    { type: "message", role: "developer", content: [...] },
    { type: "message", role: "user", content: [...], id: "msg_abc" },
    { type: "item_reference", id: "rs_xyz" },  // ← AI SDK construct
    { type: "function_call", id: "fc_123" }
  ]
};
```

**Two issues**:
1. `item_reference` - AI SDK construct for server state lookup (not in Codex API spec)
2. Message IDs - Cause "item not found" with `store: false`

**ChatGPT Backend Requirement** (confirmed via testing):
```json
{"detail":"Store must be set to false"}
```

**Errors that occurred**:
```
❌ "Item with id 'msg_abc' not found. Items are not persisted when `store` is set to false."
❌ "Missing required parameter: 'input[3].id'" (when item_reference has no ID)
```

### The Solution

**Filter AI SDK Constructs + Strip IDs** (`lib/request/request-transformer.ts`, `filterInput`):
```typescript
export function filterInput(input: InputItem[]): InputItem[] {
  return input
    .filter((item) => {
      // Remove AI SDK constructs not supported by Codex API
      if (item.type === "item_reference") {
        return false;  // AI SDK only - references server state
      }
      return true;  // Keep all other items
    })
    .map((item) => {
      // Strip IDs from all items (stateless mode)
      if (item.id) {
        const { id, ...itemWithoutId } = item;
        return itemWithoutId as InputItem;
      }
      return item;
    });
}
```

**Why this approach?**
1. ✅ **Filter `item_reference`** - Not in Codex API, AI SDK-only construct
2. ✅ **Keep all messages** - LLM needs full conversation history for context
3. ✅ **Strip ALL IDs** - Matches Codex CLI stateless behavior
4. ✅ **Future-proof** - No ID pattern matching, handles any ID format

### Debug Logging

The plugin logs ID filtering for debugging:

```typescript
// Before filtering
console.log(`[openai-codex-plugin] Filtering ${originalIds.length} message IDs from input:`, originalIds);

// After filtering
console.log(`[openai-codex-plugin] Successfully removed all ${originalIds.length} message IDs`);

// Or warning if IDs remain
console.warn(`[openai-codex-plugin] WARNING: ${remainingIds.length} IDs still present after filtering:`, remainingIds);
```

**Source**: `lib/request/request-transformer.ts` (`transformRequestBody` debug logging)

---

## Reasoning Content Flow

### Context Preservation Without Storage

**Challenge**: How to maintain context across turns when `store:false` means no server-side storage?

**Solution**: Use `reasoning.encrypted_content`

```typescript
body.include = modelConfig.include || ["reasoning.encrypted_content"];
```

**How it works**:
1. **Turn 1**: Model generates reasoning, encrypted content returned
2. **Client**: Stores encrypted content locally
3. **Turn 2**: Client sends encrypted content back in request
4. **Server**: Decrypts content to restore reasoning context
5. **Model**: Has full context without server-side storage

**Flow Diagram**:
```
Turn 1:
Client → [Request without IDs] → Server
         Server → [Response + encrypted reasoning] → Client
         Client stores encrypted content locally

Turn 2:
Client → [Request with encrypted content, no IDs] → Server
         Server decrypts reasoning context
         Server → [Response + new encrypted reasoning] → Client
```

**Codex CLI equivalent** (external Codex CLI `codex-rs/core/src/client.rs`):
```rust
let include: Vec<String> = if reasoning.is_some() {
    vec!["reasoning.encrypted_content".to_string()]
} else {
    vec![]
};
```

**Source**: `lib/request/request-transformer.ts` (`resolveInclude` and `transformRequestBody`)

---

## Request Pipeline

### Transformation Steps

~~~text
1. Parse OpenCode request body
   - Preserve the original payload shape before any optional rewrites

2. Request transform mode gate
   - native (default): keep host payload unchanged
   - legacy: fetch Codex instructions and apply compatibility transforms

3. Legacy-mode transforms (when enabled)
   - Normalize model aliases to canonical Codex IDs
   - Filter unsupported AI SDK constructs (item_reference)
   - Strip IDs for stateless compatibility (store: false)
   - Apply bridge or tool-remap prompt logic (codexMode)
   - Normalize orphaned tool outputs and inject missing outputs

4. Common post-processing
   - Resolve reasoning + verbosity settings
   - Ensure include contains reasoning.encrypted_content
   - Force store: false and stream: true for ChatGPT backend

5. Header shaping
   - Add OAuth/account headers
   - Preserve host-provided prompt_cache_key session headers when present
~~~

**Source**: `lib/request/fetch-helpers.ts` and `lib/request/request-transformer.ts`

---

## Comparison with Codex CLI

### What We Match

| Feature | Codex CLI | This Plugin | Match? |
|---------|-----------|-------------|--------|
| **OAuth Flow** | ✅ PKCE + ChatGPT login | ✅ Same | ✅ |
| **store Parameter** | `false` (ChatGPT) | `false` | ✅ |
| **Message IDs** | Stripped in stateless | Stripped | ✅ |
| **reasoning.encrypted_content** | ✅ Included | ✅ Included | ✅ |
| **Model Normalization** | "gpt-5" / "gpt-5-codex" / "codex-mini-latest" | Same | ✅ |
| **Reasoning Effort** | medium (default) | opinionated defaults by model family (for example GPT-5.3/5.2 Codex prefer `xhigh`) | ⚠️ (intentional) |
| **Text Verbosity** | model-dependent defaults | config-driven (default: medium) | ✅ |

### What We Add

| Feature | Codex CLI | This Plugin | Why? |
|---------|-----------|-------------|------|
| **Codex-OpenCode Bridge** | N/A (native) | ✅ Legacy-mode prompt injection | OpenCode -> Codex behavioral translation when legacy mode is enabled |
| **OpenCode Prompt Filtering** | N/A | ✅ Legacy-mode prompt filtering | Removes OpenCode prompts and keeps env/AGENTS context in legacy mode |
| **Orphan Tool Output Handling** | ✅ Drop orphans | ✅ Convert to messages | Preserve context + avoid 400s |
| **Usage-limit messaging** | CLI prints status | ✅ Friendly error summary | Surface 5h/weekly windows in OpenCode |
| **Per-Model Options** | CLI flags | ✅ Config file | Better UX in OpenCode |
| **Custom Model Names** | No | ✅ Display names | UI convenience |

---

## Design Rationale

### Why Not store:true?

**Pros of store:true**:
- ✅ No ID filtering needed
- ✅ Server manages conversation
- ✅ Potentially more robust

**Cons of store:true**:
- ❌ Diverges from Codex CLI behavior
- ❌ Requires conversation ID management
- ❌ More complex error handling
- ❌ Unknown server-side storage limits

**Decision**: Use `store:false` for Codex parity and simplicity.

### Why Complete ID Removal (Legacy Mode)?

**Alternative**: Filter specific ID patterns (`rs_*`, `msg_*`, etc.)

**Problem**:
- ID patterns may change
- New ID types could be added
- Partial filtering is brittle

**Solution**: Remove **ALL** IDs

**Rationale**:
- Matches Codex CLI behavior exactly
- Future-proof against ID format changes
- Simpler implementation (no pattern matching)
- Clearer semantics (stateless = no IDs)

### Why Codex-OpenCode Bridge?

**Problem**: OpenCode's system prompts are optimized for OpenCode's tool set and behavior patterns.

**Solution**: Replace OpenCode prompts with Codex-specific instructions.

**Benefits**:
- ✅ Explains tool name differences (apply_patch intent → patch/edit)
- ✅ Documents available tools
- ✅ Maintains OpenCode working style
- ✅ Preserves Codex best practices
- ✅ 90% reduction in prompt tokens

**Source**: `lib/prompts/codex-opencode-bridge.ts`

### Why Per-Model Config Options?

**Alternative**: Single global config

**Problem**:
- `gpt-5-codex` optimal settings differ from `gpt-5.4` or `gpt-5.4-mini`
- Users want quick switching between quality levels
- No way to save "presets"

**Solution**: Per-model options in config

**Benefits**:
- ✅ Save multiple configurations
- ✅ Quick switching (no CLI args)
- ✅ Descriptive names ("Fast", "Balanced", "Max Quality")
- ✅ Persistent across sessions

**Source**: `config/opencode-legacy.json` (legacy) or `config/opencode-modern.json` (variants)

---

## Error Handling

### Common Errors

#### 1. "Item with id 'X' not found"
**Cause**: Message ID leaked through filtering
**Fix**: Improved `filterInput()` removes ALL IDs
**Prevention**: Debug logging catches remaining IDs

#### 2. Token Expiration
**Cause**: OAuth access token expired
**Fix**: `shouldRefreshToken()` checks expiration
**Prevention**: Auto-refresh before requests

#### 3. "store: false" Validation Error (Azure)
**Cause**: Azure doesn't support stateless mode
**Workaround**: Codex CLI uses `store: true` for Azure only
**This Plugin**: Only supports ChatGPT OAuth (no Azure)

---

## Multi-Account Rotation

### Health-Based Account Selection

The plugin tracks account health and uses intelligent rotation:

```
Account Selection Flow:
1. Score = (health × 2) + (tokens × 5) + (freshness × 0.1)
2. Select account with highest score
3. Consume token from bucket
4. On success: health +1
5. On rate limit: health -10, mark rate-limited
6. On failure: health -20
7. Passive recovery: +2 health/hour
```

### Token Bucket Rate Limiting

Client-side rate limiting prevents hitting API limits:

| Parameter | Value |
|-----------|-------|
| Max tokens | 50 |
| Regeneration | 6 tokens/min |
| Consume per request | 1 token |

### Reason-Aware Backoff

Different rate limit reasons use different backoff multipliers:

| Reason | Multiplier | Description |
|--------|------------|-------------|
| `quota` | 3.0× | Daily quota exhausted |
| `tokens` | 1.5× | Token limit hit |
| `concurrent` | 0.5× | Concurrent request limit |
| `unknown` | 1.0× | Default |

### RefreshQueue

Prevents race conditions when multiple concurrent requests try to refresh the same token:

```typescript
// Without RefreshQueue: N concurrent requests = N refresh attempts
// With RefreshQueue: N concurrent requests = 1 refresh, N-1 await

const queue = getRefreshQueue();
const tokens = await queue.queuedRefresh(refreshToken, async () => {
  return await actualRefresh(refreshToken);
});
```

**Source**: `lib/refresh-queue.ts`, `lib/rotation.ts`

---

## Beginner Operations & Safety Layer

The plugin now includes a beginner-focused operational layer in `index.ts` and `lib/ui/beginner.ts`:

1. **Startup preflight summary**
   - Runs once per plugin loader lifecycle.
   - Computes account readiness (`healthy`, `blocked`, `rate-limited`) and surfaces a single next action.
   - Emits both toast + log summary.

2. **Checklist and wizard flow**
   - `codex-setup` renders a checklist (`add account`, `set active`, `verify health`, `label accounts`, `learn commands`).
   - `codex-setup --wizard` launches an interactive menu when terminal supports TTY interaction.
   - Wizard gracefully falls back to checklist output when menus are unavailable.

3. **Doctor + next-action diagnostics**
   - `codex-doctor` maps runtime/account states into severity findings (`ok`, `warning`, `error`) with specific action text.
   - `codex-doctor --fix` performs safe remediation:
     - refreshes tokens using queued refresh,
     - persists refreshed credentials,
     - switches active account to healthiest eligible account when beneficial.
   - `codex-next` returns exactly one recommended next action.

4. **Interactive index selection**
   - `codex-switch`, `codex-label`, and `codex-remove` accept optional `index`.
   - In interactive terminals, missing index opens a picker menu.
   - In non-interactive contexts, commands return explicit usage guidance.

---

## Account Metadata + Backup Safety

Storage schema now supports account metadata fields used by operational tooling:

- `accountLabel` (existing)
- `accountTags` (new): normalized lowercase tag array for grouping/filtering
- `accountNote` (new): short reminder text

Operational implications:

1. `codex-list` supports tag filtering (`tag`) and shows tags in account labels.
2. `codex-tag` and `codex-note` update metadata with persistence + manager cache reload.
3. Export/import flow hardening:
   - `codex-export` can auto-generate timestamped paths (`createTimestampedBackupPath()`),
   - `codex-import` supports `dryRun` via `previewImportAccounts()`,
   - non-dry-run imports create timestamped pre-import backups before applying changes when existing accounts are present.

---

## Performance Considerations

### Token Usage

**Codex Bridge Prompt**: ~550 tokens (~90% reduction vs full OpenCode prompt)
**Benefit**: Faster inference, lower costs

### Request Optimization

**Prompt Caching**: Uses `promptCacheKey` for session-based caching
**Result**: Reduced token usage on subsequent turns

**Source**: external OpenCode provider transform implementation

---

## Future Improvements

### Potential Enhancements

1. **Azure Support**: Add `store: true` mode with ID management
2. **Version Detection**: Adapt to OpenCode/AI SDK version changes
3. **Config Validation**: Warn about unsupported options
4. **Test Coverage**: Unit tests for all transformation functions
5. **Performance Metrics**: Log token usage and latency

## Terminal UI Runtime (Codex TUI v2)

The plugin now supports a Codex-style terminal presentation layer for both interactive menus and text tool outputs.

- Default: enabled (`codexTuiV2: true`)
- Opt-out: `codexTuiV2: false` or `CODEX_TUI_V2=0`
- Color profile selection:
  - `codexTuiColorProfile: "truecolor" | "ansi256" | "ansi16"`
  - `CODEX_TUI_COLOR_PROFILE`
- Glyph mode selection:
  - `codexTuiGlyphMode: "ascii" | "unicode" | "auto"`
  - `CODEX_TUI_GLYPHS`

Legacy output remains unchanged when V2 is disabled.

### Breaking Changes to Watch

1. **AI SDK Updates**: Changes to `.responses()` method
2. **OpenCode Changes**: New message ID formats
3. **Codex API Changes**: New request parameters

---

## See Also
- [CONFIG_FLOW.md](./CONFIG_FLOW.md) - Configuration system guide
- [TUI_PARITY_CHECKLIST.md](./TUI_PARITY_CHECKLIST.md) - Auth dashboard and interaction parity checklist
- [Codex CLI Source](https://github.com/openai/codex) - Official implementation
- [OpenCode Source](https://github.com/sst/opencode) - OpenCode implementation
