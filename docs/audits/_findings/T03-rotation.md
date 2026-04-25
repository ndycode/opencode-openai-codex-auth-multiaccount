---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T03 rotation
generated: 2026-04-25T12:45:33+08:00
---

# T03 Rotation

Current rotation implementation is split across:

- `lib/accounts/rotation.ts`
- `lib/accounts/rate-limits.ts`
- `lib/accounts/state.ts`
- `lib/accounts/recovery.ts`
- `lib/rotation.ts`

Current tests include account rotation, integration rotation, rate-limit backoff, refresh queue, and concurrency-focused account failure counters.

No active Critical rotation finding was confirmed in this refresh.
