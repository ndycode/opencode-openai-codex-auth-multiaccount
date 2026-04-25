> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00

# Dedup Report

Deduplication policy:

- Prefer current-source findings over historical claims.
- Collapse repeated old monolith claims into one resolved architecture row.
- Aggregate destructive-export claims into one resolved tool/storage row.
- Consolidate config continuity claims into one resolved config row.

Dedup result:

| Cluster | Canonical row | Status |
| --- | --- | --- |
| Tool monolith | A001 | Resolved |
| Storage monolith | A002 | Resolved |
| Remove confirmation | C001 | Resolved |
| Export overwrite | C002 | Resolved |
| Minimal config continuity | C003 | Resolved |
