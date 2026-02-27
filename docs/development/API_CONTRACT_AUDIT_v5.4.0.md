# API Contract Audit (v5.3.4..HEAD)

## Audit Intent

This audit verifies public contract stability and caller impact for `v5.3.4..HEAD`, then adds explicit compatibility guardrails where contract ambiguity existed.

## Methodology

1. Compared exported TypeScript signatures in touched public modules against `v5.3.4`.
2. Compared `codex-*` tool inventory in `index.ts` against `v5.3.4`.
3. Reviewed changed caller-facing docs/examples for drift and migration risk.
4. Added compatibility tests for both legacy and new command argument forms.
5. Classified every public-surface delta as breaking/non-breaking and mapped migration paths.

## Public Surface Inventory

### Exported Symbol Diffs (v5.3.4 vs HEAD)

| File | Export Signature Diff |
|------|------------------------|
| `index.ts` | none |
| `lib/storage.ts` | none |
| `lib/auth/token-utils.ts` | none |

Conclusion: no exported signature removals/renames in touched public modules.

### Tool Name Inventory Diffs (v5.3.4 vs HEAD)

Tool inventory is unchanged (17 tools):

- `codex-list`
- `codex-switch`
- `codex-status`
- `codex-metrics`
- `codex-help`
- `codex-setup`
- `codex-doctor`
- `codex-next`
- `codex-label`
- `codex-tag`
- `codex-note`
- `codex-dashboard`
- `codex-health`
- `codex-remove`
- `codex-refresh`
- `codex-export`
- `codex-import`

Conclusion: no tool removals/renames.

## Changed Public Contracts

### `codex-setup` contract

- Added additive argument: `mode` (`checklist` | `wizard`).
- Retained legacy argument: `wizard?: boolean`.
- Added conflict/validation handling:
  - invalid mode -> `Invalid mode: ...`
  - conflicting `mode` + `wizard` -> `Conflicting setup options: ...`

Compatibility: **non-breaking additive**.

### `codex-doctor` contract

- Added additive argument: `mode` (`standard` | `deep` | `fix`).
- Retained legacy arguments: `deep?: boolean`, `fix?: boolean`.
- Added conflict/validation handling:
  - invalid mode -> `Invalid mode: ...`
  - conflicting `mode` + `deep`/`fix` -> `Conflicting doctor options: ...`

Compatibility: **non-breaking additive**.

## Caller Impact and Migration

### Existing callers (kept valid)

- `codex-setup wizard=true`
- `codex-doctor deep=true`
- `codex-doctor fix=true`

### Recommended forward usage

- `codex-setup mode="wizard"`
- `codex-doctor mode="deep"`
- `codex-doctor mode="fix"`

### Why migrate

- `mode` is less ambiguous in scripts/reviews than multiple booleans.
- explicit mode names are easier to reason about and document.

## Error Contract Matrix

| API | Condition | Error Representation | Caller Action |
|-----|-----------|----------------------|---------------|
| `codex-setup` | `mode` not in `{checklist,wizard}` | string containing `Invalid mode` | send valid mode |
| `codex-setup` | `mode` conflicts with `wizard` | string containing `Conflicting setup options` | provide one coherent mode choice |
| `codex-doctor` | `mode` not in `{standard,deep,fix}` | string containing `Invalid mode` | send valid mode |
| `codex-doctor` | `mode` conflicts with `deep`/`fix` | string containing `Conflicting doctor options` | provide one coherent mode choice |

## File-by-File Compatibility Classification

| Changed File in Range | Public API Impact | Classification |
|-----------------------|-------------------|----------------|
| `index.ts` | Tool argument extensions + validation messages | non-breaking additive |
| `lib/storage.ts` | Identity dedupe behavior hardening; no signature drift | non-breaking behavioral fix |
| `lib/auth/token-utils.ts` | Canonical org-id extraction behavior hardening; no signature drift | non-breaking behavioral fix |
| `README.md`, `docs/*` | Contract docs alignment and migration guidance | non-breaking docs |
| `test/*` | Contract regression coverage | non-breaking tests |
| `package.json`, `package-lock.json` | release/version metadata in baseline range | non-breaking metadata |

## Anti-Pattern Review

- Boolean-heavy command mode selection was a caller-facing ambiguity risk.
- Mitigation applied:
  - Added explicit mode enums without removing legacy booleans.
  - Added conflict guards to prevent silent contradictory input.
  - Updated docs/examples to explicit mode syntax.

## Versioning Recommendation

- Suggested bump for this follow-up work: **MINOR**
- Rationale:
  - New caller-visible capabilities (`mode`) are additive.
  - Existing contracts remain supported.
  - No removals/renames requiring MAJOR.

## Validation Evidence

- Export signature comparison: no diffs in touched public modules.
- Tool inventory comparison: no name diffs across `v5.3.4` and `HEAD`.
- Automated checks:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
- Added tests for:
  - explicit `mode` behavior (`checklist`, `wizard`, `standard`, `deep`, `fix`)
  - legacy boolean compatibility
  - invalid/conflicting input handling

## Final Compatibility Verdict

- Breaking changes: **none found**
- Merge readiness from API-contract perspective: **ready**
