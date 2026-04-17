# F1 (#132) Post-Merge Security Review

> **Reviewer**: oracle (adversarial post-merge review)
> **Review date**: 2026-04-18
> **Commit reviewed**: `ae75093` on `main`
> **Verdict**: **APPROVE-WITH-FOLLOWUPS**

## Summary

F1 lands a correctly scoped, genuinely opt-in OS-keychain backend. The default-off
contract is airtight (`CODEX_KEYCHAIN === "1"` strict equality, no probe calls when
unset, a dedicated regression test asserts zero mock calls on the baseline path),
the fallback-on-every-error contract holds end-to-end, and no secret material
leaks through logs or error strings. Findings below are real but non-blocking:
one HIGH atomicity issue around partial migration, a couple of MEDIUMs on
rollback UX and `clearAccounts` ordering, plus LOW/NIT hygiene items. None
warrant revert; all can be cleaned up in a small follow-up PR.

## Findings

### [HIGH] Partial-migration window: keychain write succeeds, JSON rename fails -> duplicated source of truth
- **File**: `lib/storage/load-save.ts:535-554` (`saveAccountsUnlocked`) and `lib/storage/load-save.ts:507-527` (`migrateOnDiskJsonToKeychainBackup`)
- **Issue**: After a successful keychain write, `migrateOnDiskJsonToKeychainBackup` attempts to rename the JSON file. If the rename fails (EACCES, EBUSY on Windows, disk full, parent dir permission drift), the failure is swallowed with `log.warn` and `saveAccountsUnlocked` returns success. The on-disk JSON now holds a **stale-but-valid** V3 blob while the keychain holds the authoritative fresh blob. On the next `loadAccounts` with opt-in still set, the keychain read wins and everything is fine - but if the user **disables the opt-in** (unsets `CODEX_KEYCHAIN`) they are silently rolled back to the stale JSON with no warning. The code comment acknowledges "at worst a duplicate JSON file on disk" but the real blast radius is silent staleness across an opt-in toggle.
- **Evidence**:
  ```ts
  // lib/storage/load-save.ts:520-526
  } catch (err) {
    log.warn("keychain: failed to rename on-disk JSON after successful keychain write", {
      path, error: String(err),
    });
  }
  // saveAccountsUnlocked then returns normally -> caller sees success
  ```
- **Fix**: Either (a) overwrite the stale JSON with the new blob when the rename fails (so the on-disk copy remains consistent), or (b) on every opt-in `loadAccounts`, if both keychain entry and non-suffixed JSON exist, log a HIGH-severity warning. Option (a) is simpler and keeps the rollback invariant.

### [MEDIUM] `clearAccounts` order: keychain delete before JSON unlink can resurrect credentials on error
- **File**: `lib/storage/load-save.ts:602-627`
- **Issue**: When opt-in is on, the keychain entry is deleted first (line 611), then the JSON file is unlinked (line 620). If the unlink fails for a non-ENOENT reason (permission, EBUSY), the keychain is cleared but the JSON remains. A subsequent `loadAccounts` with opt-in **still on** sees `keychain -> null` (line 319: "no entry found; falling back to JSON read") and resurrects the "deleted" credentials from the JSON file. The fallback path was designed for read-time keychain *unavailability*, not for an explicit `clearAccounts`. Combined with the fact that users typically run `clearAccounts` to *recover* from a bad credential set (e.g. leaked token), this is a meaningful failure mode.
- **Evidence**: The code comment on line 604-607 asserts "a subsequent load would resurrect" exactly this scenario but only considers the inverse ordering.
- **Fix**: Reverse the order - unlink JSON first, then delete keychain entry. On unlink failure propagate the error (or at least log at `error` and skip keychain delete so callers can retry).

### [MEDIUM] `rollback` silently overwrites a live JSON file when one exists alongside a `.migrated-to-keychain.<ts>` backup
- **File**: `lib/tools/codex-keychain.ts:188-224`
- **Issue**: `rollback` calls `clearAccounts()` (line 212) and then `fs.rename(mostRecent, storagePath)` (line 214). `clearAccounts` only unlinks the current JSON inside `try { fs.unlink(path) } catch {}` - if the unlink fails silently, or if a race write has just landed a new JSON at `storagePath`, the subsequent `fs.rename` on POSIX will clobber it without confirmation. On Windows the rename would throw EEXIST and the tool surfaces the error, but the POSIX path is the silent one. User may reasonably expect rollback to be non-destructive of a current live JSON.
- **Evidence**:
  ```ts
  // lib/tools/codex-keychain.ts:212-217
  await clearAccounts();               // best-effort unlink; failure swallowed
  try { await fs.rename(mostRecent, storagePath); }  // POSIX overwrite on conflict
  ```
- **Fix**: Before `rename`, `fs.access(storagePath)` - if it still exists, either refuse with an explicit error message ("current accounts file already present; move it aside first") or archive it with a `.pre-rollback.<ts>` suffix.

### [MEDIUM] `rollback` backup selection is lexicographic, not timestamp-aware
- **File**: `lib/tools/codex-keychain.ts:64-77` (`findMigrationBackups`)
- **Issue**: Backups are named `<path>.migrated-to-keychain.<ISO-ts-with-:-and-.-replaced-by-->` (see `lib/storage/load-save.ts:513`). The sort on line 75 is a bare string comparison (`a < b ? 1 : a > b ? -1 : 0`). For timestamps produced by `new Date().toISOString().replace(/[:.]/g, "-")` this happens to sort correctly *because ISO-8601 is lexicographically ordered when all fields are zero-padded and fixed-width*. However the file header comments promise "fallback to filename sort when the suffix is unparseable so we degrade gracefully" - there is **no** actual timestamp parse + fallback. If the format ever changes (new epoch, locale mishap, test fixture with non-ISO suffix) the rollback picks whatever sorts last alphabetically - which may not be the most recent. Low blast radius today; silent trap on format change.
- **Evidence**: `lib/tools/codex-keychain.ts:74-75` - no `Date.parse`, no try/catch, doc/code mismatch.
- **Fix**: Parse the timestamp portion, sort by epoch, fall back to string sort only when parse returns `NaN`. Or tighten the doc comment to state "lexicographic-only sort, relies on ISO-8601 invariant".

### [LOW] Availability probe has a keychain-write side effect that can prompt the user
- **File**: `lib/storage/keychain.ts:146-163`
- **Issue**: `isAvailable()` calls `entry.setPassword("probe"); entry.deletePassword();` against the real OS keychain. On macOS the **first-ever** write from a new signed binary can trigger a "allow/always allow" prompt. `codex-keychain status` is advertised as a read-only status command in the docs and tool description, but it actually triggers a write-side-effect on the keychain and may pop a user prompt. This is a UX surprise, not a data-safety issue.
- **Evidence**: README line 143 + SECURITY.md paragraph describe `status` as reporting reachability; nothing warns that it performs a mutating probe.
- **Fix**: Either (a) probe with a read-only operation (try `getPassword` on a fixed probe key, treat any non-throw as available) or (b) document the side effect in README / tool description and add a `--no-probe` flag.

### [LOW] Backup file inherits the default umask, not the `0o600` applied to active JSON
- **File**: `lib/storage/load-save.ts:516` (`fs.rename(path, backup)`)
- **Issue**: The active JSON is written with `mode: 0o600` via `writeAccountsToPathUnlocked` (line 460). On rename, the file retains its inode/mode, so the `.migrated-to-keychain.<ts>` backup keeps `0o600` at first. However, if a user ever restores via `codex-keychain rollback`, that rename also preserves the mode - but if anyone `cp`'s or manually touches the file between migration and rollback, the restored file may end up world-readable. The code doesn't re-apply `chmod 0o600` after rename on either side.
- **Evidence**: No `fs.chmod` call in either `migrateOnDiskJsonToKeychainBackup` or the rollback flow.
- **Fix**: `await fs.chmod(backup, 0o600)` after rename (and again in rollback path). Cheap belt-and-braces for filesystem permission drift.

### [LOW] Availability probe account key is not namespaced to avoid future collision
- **File**: `lib/storage/keychain.ts:151`
- **Issue**: The probe uses account `"__availability_probe__"` while real entries use `"accounts:<project-key>"`. No collision today because real keys always have the `accounts:` prefix. Still, a future refactor that drops the prefix could silently corrupt the probe. Worth locking down.
- **Fix**: Prefix with `__probe:` or include the service name: `__availability_probe__@oc-codex-multi-auth`. Trivially low-risk as-is; flag for hygiene.

### [LOW] `codex-keychain status` probes the keychain even when opt-in is unset
- **File**: `lib/storage/keychain.ts:269-273` + `lib/tools/codex-keychain.ts:110`
- **Issue**: `codex-keychain status` calls `keychainIsAvailable()` unconditionally (line 110) - *including when `CODEX_KEYCHAIN` is unset*. If the native module loads successfully on a user's machine with opt-in off, running `codex-keychain status` still writes a probe entry to the OS keychain. The tool description promises opt-in semantics; this creates a tiny, transient keychain entry without opt-in. Not a security issue (entry is deleted immediately) but violates the "unset == no keychain code path" invariant the PR advertises. Note: `saveAccounts` / `loadAccounts` / `clearAccounts` correctly short-circuit on `isKeychainOptInEnabled()`; only the status tool bypasses this gate.
- **Evidence**: `codex-keychain.ts:110` calls `keychainIsAvailable()` regardless of `optIn`; `optIn` is only read for the `keychainHasEntry` flag (line 111).
- **Fix**: Skip the probe when `optIn === false` and report "keychain reachable: (not checked; CODEX_KEYCHAIN unset)". Preserves strict opt-in.

### [NIT] Misleading comment about `async` + `require-await` suppressions in the backend wrapper
- **File**: `lib/storage/keychain.ts:105-112`
- **Issue**: The comment block says the suppressions exist "to keep intent explicit". Standard approach would be to drop `async` on the methods and rely on the interface declaring `Promise<T>`, or return `Promise.resolve(...)`. The per-method `// eslint-disable-next-line` is noisy. Code-style nit; zero security impact.
- **Fix**: Drop `async`, return `Promise.resolve(...)` where needed, or rewrap with `(async () => ...)()`.

### [NIT] Test at line 188-203 contains a confused setup that does not test what its title claims
- **File**: `test/storage-keychain.test.ts:188-203`
- **Issue**: The test "readFromKeychain returns null when backend is unavailable" sets a mock (!) then calls `readFromKeychain("never-written-key")` and expects `null`. This asserts "mock backend returns null for a missing key", not "backend unavailable" (which would be `cachedBackend === null`). The inline comment acknowledges the confusion ("For this assertion we still need a mock: a null backend would take the 'unavailable' branch"). The null-backend branch at `keychain.ts:211` (`if (!backend) return null`) is therefore **not directly tested**. Coverage-wise it is likely hit by other tests, but the assertion as written is misleading.
- **Fix**: Split into two tests: (1) mock returns null for missing key; (2) genuinely-unavailable backend (reset + do not inject) returns null. The second needs `_resetBackendForTests` + a way to force `loadNativeBackend` to return `null` (e.g. module mock of `@napi-rs/keyring` via `vi.doMock`).

### [NIT] Dependency caret range on a credential-handling dep
- **File**: `package.json:99`
- **Issue**: `"@napi-rs/keyring": "^1.2.0"` allows any 1.x up through 1.999.x. For a package that will exfiltrate the exact bytes of a refresh token to native code, tighter pinning (`~1.2.0` or exact) would reduce supply-chain surface. Integrity is SHA-512-pinned in `package-lock.json` across all 12 platform variants, so the current install is safe — but a fresh `npm install` on a machine without the lockfile would resolve to the newest 1.x.
- **Fix**: Tighten to `~1.2.0` and gate minor bumps on an explicit review.

## Verdict Rationale

The feature is functionally sound and the default-off guarantee (the primary
safety invariant) is verified by an explicit regression test
(`test/storage-keychain.test.ts:382-390`: `expect(mock.calls).toHaveLength(0)`
after full save -> load roundtrip). No secret material reaches logs, error
strings, or test fixtures (spot-grep confirms no `eyJ`, `sk-`, or 40+ hex
outside of redaction-test fixtures). `_setBackendForTests` has zero production
callers; only the test file imports it. The `@napi-rs/keyring@1.2.0` dependency
is SHA-512 integrity-pinned in `package-lock.json` across 12 platform variants,
and the dynamic-import fallback means a missing prebuilt binary degrades
gracefully to JSON.

The HIGH finding (partial-migration staleness) is a real edge case but
extremely rare in practice and only becomes user-visible after an opt-in
toggle - not a revert-worthy blast radius. The MEDIUMs are genuine rough
edges on the rollback UX and `clearAccounts` ordering. Nothing in this
review blocks ship; all findings fit in a small follow-up PR.

## Recommended follow-ups

- Small PR #1 (credentials safety): fix HIGH (partial-migration staleness) + the two MEDIUM `clearAccounts` / `rollback` ordering issues together - all three are one-liners in `load-save.ts` and `codex-keychain.ts`.
- Small PR #2 (hygiene): gate `keychainIsAvailable` on `isKeychainOptInEnabled` (LOW), add `fs.chmod 0o600` post-rename (LOW), namespace the probe account key (LOW).
- Doc-only: update README / `codex-keychain status` description to reflect that the command may trigger an OS-keychain prompt on first run (macOS), until the probe becomes read-only.
- Test hardening: replace the confused "unavailable backend returns null" case with a genuine missing-module scenario using `vi.doMock("@napi-rs/keyring", ...)`.
- Dependency hygiene: tighten `@napi-rs/keyring` range (NIT) and add a dependabot/renovate rule requiring manual review on minor bumps for credential-handling deps.

## Checklist coverage

| Area | Status | Key evidence |
|---|---|---|
| A. Opt-in safety | PASS | `isKeychainOptInEnabled` strict `=== "1"`; regression test `test:382-390` asserts `mock.calls.length === 0` |
| B. Migration safety | PARTIAL | HIGH finding on partial-migration atomicity; rollback path exists |
| C. Fallback safety | PASS | Every error path falls through to JSON; tested at `test:308-324` |
| D. Secret leakage | PASS | No raw secrets in log calls; error messages carry native message only; no tokens in test fixtures |
| E. Backend abstraction integrity | PASS | `_setBackendForTests` has zero production callers (verified via grep) |
| F. Dependency risk | PASS with NIT | `@napi-rs/keyring@1.2.0`, SHA-512 pinned; caret range could tighten |
| G. Cross-platform gotchas | PARTIAL | LOW finding on macOS prompt; Linux fallback path correct |
| H. Account key collision | PASS | `accounts:<project-hash>` format; global uses reserved sentinel |
| I. Rollback UX | PARTIAL | Two MEDIUMs (clobber + sort correctness) |
| J. Test quality | PASS with NIT | Baseline regression test is rigorous; one confused test case |

**Finding counts**: HIGH: 1, MEDIUM: 3, LOW: 4, NIT: 3. Total: 11.
