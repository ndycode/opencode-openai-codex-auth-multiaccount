---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T16 code health
generated: 2026-04-25T12:45:33+08:00
---

# T16 Code Health

Current code-health evidence:

- `index.ts` spans 3694 lines but no longer owns inline tool bodies.
- `lib/storage.ts` serves as a 79-line facade.
- `lib/accounts.ts` functions as a 366-line facade/orchestrator.
- `lib/tools/index.ts` maps exactly 21 tool factories.
- Largest remaining concentration is the request layer.

Current recommendation: keep future cleanup incremental and behavior-led. Do not start a broad request-layer rewrite from this audit refresh alone.
