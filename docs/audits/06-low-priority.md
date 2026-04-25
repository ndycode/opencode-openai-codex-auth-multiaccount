> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: low findings

# Low Priority

| ID | Area | Current evidence | Recommendation |
| --- | --- | --- | --- |
| L01 | Docs version markers | Some architecture sections retain historical feature-version headings. | Keep them as history, but avoid using them as current structure claims. |
| L02 | Tool usage examples | Some examples use `index=2` as a placeholder. | Prefer interactive form or add `confirm=true` where destructive. |
| L03 | Audit process | The prior audit corpus had stale line anchors. | Keep `test/doc-parity.test.ts` stale-anchor checks. |
| L04 | Package smoke | Tarball import smoke is manual today. | Consider a dedicated package-smoke test script later. |
| L05 | Release docs | PR template lacks `audit:ci` and coverage entries. | Update when release policy is next revised. |
