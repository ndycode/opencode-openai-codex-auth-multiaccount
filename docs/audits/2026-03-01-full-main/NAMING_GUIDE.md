## Naming Conventions: Codex Commands and Operational Docs

### Inconsistencies Found

| Concept | Variant 1 | Variant 2 | Recommended | Rationale |
|---|---|---|---|---|
| Account synchronization command | Mentioned in help text only | Missing dedicated command section | `codex-sync` as first-class command section | Every implemented command should have one canonical doc location. |
| Test volume claims | Exact stale value (`1,767 tests`) | Current runtime count (`1,776`) | `1,700+ tests` | Avoid frequent stale-count drift while remaining informative. |
| Runtime dependency statement | "Only dependency" in `SECURITY.md` | Actual runtime dependency set has four packages | Explicit runtime dependency list | Security docs must match shipped dependency surface. |

### Naming Rules

| Rule | Example | Counter-example |
|---|---|---|
| Same concept, same token | Use `codex-sync` everywhere (code, help, docs) | Describing sync behavior without naming `codex-sync` in command reference |
| Prefer stable qualitative counts in docs | `1,700+ tests` | Hardcoded exact values that drift every release |
| Security docs describe current dependency surface | List all runtime dependencies | Claiming a single dependency when multiple are present |

### Glossary

| Term | Definition | Usage Context |
|---|---|---|
| `codex-sync` | Command to pull/push account state between plugin storage and Codex CLI auth storage | User command docs, troubleshooting flows |
| Runtime dependency | Package required by published plugin at runtime | Security and release documentation |
| Validation gate | Required command that must pass before release/PR | CI workflow and audit evidence |
