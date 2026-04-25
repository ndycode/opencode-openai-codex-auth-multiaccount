---
sha: 3331324cb14d2b80dd8dfb424619870a88476706
task: T07 concurrency
generated: 2026-04-25T12:45:33+08:00
---

# T07 Concurrency

Current concurrency surfaces:

- Account persistence debounce and flush lifecycle: `lib/accounts/persistence.ts`.
- Account failure counters and hydration: `lib/accounts/recovery.ts`.
- Token refresh serialization: `lib/refresh-queue.ts`.
- Rate-limit backoff dedupe: `lib/request/rate-limit-backoff.ts`.
- Circuit breaker: `lib/circuit-breaker.ts`.

The current suite includes dedicated rotation, refresh-queue, storage lock, and chaos tests. No Critical concurrency finding was confirmed during this refresh.
