## Information Architecture: Codex Command Surface

### Current Structure

```text
Account management command namespace: codex-*

Root docs command sections (before changes):
- codex-list
- codex-switch
- codex-label
- codex-tag
- codex-note
- codex-help
- codex-setup
- codex-doctor
- codex-next
- codex-status
- codex-metrics
- codex-health
- codex-refresh
- codex-remove
- codex-export
- codex-import
- codex-dashboard

Implemented tools in code:
- All above plus codex-sync
```

### Task-to-Location Mapping (Current)

| User Task | Expected Location | Actual Location | Findability |
|---|---|---|---|
| Sync plugin account data with Codex CLI | README command reference | Mentioned indirectly in help text, no dedicated section | Lost |
| Run first-time setup | README `codex-setup` section | Present in README | Match |
| Recover from account issues | README `codex-doctor`/`codex-health` | Present in README | Match |
| Backup and restore accounts | README `codex-export`/`codex-import` | Present in README | Match |
| Validate repository CI contract from docs badge | `.github/workflows/ci.yml` | Missing workflow while badge existed | Lost |

### Proposed Structure

```text
Account management command namespace: codex-*

Root docs command sections (after changes):
- codex-list
- codex-switch
- codex-label
- codex-tag
- codex-note
- codex-help
- codex-setup
- codex-doctor
- codex-next
- codex-status
- codex-metrics
- codex-health
- codex-refresh
- codex-remove
- codex-export
- codex-import
- codex-sync
- codex-dashboard

CI discoverability:
- docs/index.md badge -> .github/workflows/ci.yml (present)
```

### Migration Path

1. Add dedicated `codex-sync` section in root command docs.
2. Add `codex-sync` to quick-reference table.
3. Restore badge target by adding `.github/workflows/ci.yml`.
4. Keep all existing command names unchanged to preserve user muscle memory.

### Task-to-Location Mapping (Proposed)

| User Task | Location | Findability Improvement |
|---|---|---|
| Sync plugin account data with Codex CLI | `README.md` -> `### codex-sync` | Lost -> Match |
| Run first-time setup | `README.md` -> `### codex-setup` | Match -> Match |
| Recover from account issues | `README.md` -> `### codex-doctor` and `### codex-health` | Match -> Match |
| Backup and restore accounts | `README.md` -> `### codex-export` and `### codex-import` | Match -> Match |
| Validate repository CI contract from docs badge | `.github/workflows/ci.yml` linked from `docs/index.md` | Lost -> Match |
