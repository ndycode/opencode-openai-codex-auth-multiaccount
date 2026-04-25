---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T14 dependencies
generated: 2026-04-25T12:45:33+08:00
---

# T14 Dependencies

Current manifest anchors:

- `npm run audit:ci` runs production audit plus dev allowlist.
- Overrides remain present for transitive advisory management.
- Node engine remains `>=18.0.0`.

This cleanup does not change dependency versions or package exports.

Required verification remains:

- `npm run audit:ci`
- `npm pack` package smoke
