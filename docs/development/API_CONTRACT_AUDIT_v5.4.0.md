# API Contract Audit (v5.3.4..HEAD)

## Scope

- Baseline: `v5.3.4`
- Target: `HEAD` (includes `v5.4.0` and current changelog updates)
- Public contract surfaces reviewed:
  - Top-level plugin exports (`index.ts`)
  - Re-exported library modules (`lib/index.ts` and exported symbols in touched modules)
  - OpenCode tool contracts (`codex-*` tool name, argument shape, output/error behavior)
  - User-facing docs for command/config/error behavior (`README.md`, `docs/`)

## Compatibility Classification

### Breaking Changes

- None detected in `v5.3.4..HEAD` for exported TypeScript signatures in touched files.
- None detected for existing `codex-*` tool names.

### Non-Breaking Changes

- `v5.4.0` identity hardening in authorize/dedupe flows (behavioral correctness fix, no signature removal).
- Additive command argument clarity:
  - `codex-setup` now accepts `mode` (`checklist` | `wizard`), while preserving legacy `wizard` boolean.
  - `codex-doctor` now accepts `mode` (`standard` | `deep` | `fix`), while preserving legacy `deep`/`fix` booleans.

## Caller Impact and Migration

### Existing Callers

- Existing usage remains valid:
  - `codex-setup wizard=true`
  - `codex-doctor deep=true`
  - `codex-doctor fix=true`

### Recommended Forward Usage

- Prefer explicit mode arguments for clarity and script readability:
  - `codex-setup mode="wizard"`
  - `codex-doctor mode="deep"`
  - `codex-doctor mode="fix"`

## Error Contract (Changed APIs)

### `codex-setup`

- Invalid `mode`:
  - Condition: `mode` not in `{checklist,wizard}`
  - Representation: string result containing `Invalid mode`
- Conflicting options:
  - Condition: `mode` and `wizard` disagree semantically
  - Representation: string result containing `Conflicting setup options`

### `codex-doctor`

- Invalid `mode`:
  - Condition: `mode` not in `{standard,deep,fix}`
  - Representation: string result containing `Invalid mode`
- Conflicting options:
  - Condition: `mode` conflicts with explicit `deep` or `fix` values
  - Representation: string result containing `Conflicting doctor options`

## API Design Notes

- Anti-pattern mitigation:
  - Replaced implicit boolean-only command style with additive enum-like `mode` input (string + runtime validation).
  - Kept legacy booleans for backward compatibility.
- Naming consistency:
  - `mode` terminology aligns across `codex-setup` and `codex-doctor`.
- Side-effect expectations:
  - `codex-doctor mode="fix"` remains the only side-effectful diagnostic mode.

## Versioning Recommendation

- Suggested bump for this follow-up work: **MINOR**
- Rationale:
  - New caller-visible capabilities were added (`mode` arguments).
  - Existing contracts remain valid (backward-compatible additive change).
  - No exported API removal/rename requiring MAJOR bump.

## Validation Evidence

- Static diff checks:
  - Export signature comparison across touched modules
  - Tool name continuity verification
- Runtime checks:
  - Added tests for valid/invalid/conflicting `mode` behavior
  - Backward-compatibility tests for legacy booleans retained
