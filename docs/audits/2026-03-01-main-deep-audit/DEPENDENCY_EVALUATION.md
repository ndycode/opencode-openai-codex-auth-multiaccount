# Dependency Evaluation: Runtime Dependencies for oc-chatgpt-multi-auth

Date: 2026-03-01
Scope: direct runtime dependency posture, alternatives, compatibility, migration risk, and license/security checks.

## Capability: OpenCode Plugin Integration

### Candidates
| Package | Version | Downloads/wk | Last Commit/Publish | License | Stars |
|---|---:|---:|---|---|---:|
| `@opencode-ai/plugin` | 1.2.15 | 1,826,527 | Published 2026-02-26; upstream repo push 2026-02-28 (inferred) | MIT | 113,016 (upstream) |
| `@opencode-ai/sdk` | 1.2.15 | 1,949,786 | Published 2026-02-26; upstream repo push 2026-02-28 (inferred) | MIT | 113,016 (upstream) |
| `@modelcontextprotocol/sdk` | 1.27.1 | 23,214,738 | GitHub push 2026-02-28 | MIT | 11,709 |

### Recommendation
**Use**: `@opencode-ai/plugin` `^1.2.15`

**Rationale**:
- Purpose-built for OpenCode plugin authoring and already integrated in this codebase.
- Fresh publish cadence and high adoption signal from npm downloads.
- MIT license is compatible with project license policy.
- Migration away from this package would increase glue code and compatibility risk.

### Risks
- Package metadata does not publish repository URL directly. Mitigation: monitor npm publish freshness and upstream opencode release activity.
- Alternative `@modelcontextprotocol/sdk` has non-zero OSV history. Mitigation: avoid unnecessary migration and preserve current integration surface.

### Migration Path (if replacing)
1. Replace `@opencode-ai/plugin/tool` usage with direct SDK or MCP server glue.
2. Rebuild tool registration adapters and invocation contracts.
3. Re-run all `index.ts` and request pipeline integration tests.

## Capability: OAuth / OIDC Utilities

### Candidates
| Package | Version | Downloads/wk | Last Commit/Publish | License | Stars |
|---|---:|---:|---|---|---:|
| `@openauthjs/openauth` | 0.4.3 | 1,089,383 | Published 2025-03-04; upstream repo push 2025-07-18 | npm metadata missing; upstream MIT | 6,688 |
| `openid-client` | 6.8.2 | 6,773,345 | GitHub push 2026-02-28 | MIT | 2,304 |
| `oauth4webapi` | 3.8.5 | 5,206,071 | GitHub push 2026-02-28 | MIT | 724 |

### Recommendation
**Use**: keep `@openauthjs/openauth` `^0.4.3` for now.

**Rationale**:
- Existing integration is stable and current tests pass without OAuth regressions.
- No current production vulnerability appears in this project's `npm audit --omit=dev` result.
- Alternatives are strong but would require reworking PKCE/token handling and callback assumptions.

### Risks
- Freshness risk: package publish date is old (2025-03-04). Mitigation: add a quarterly reevaluation checkpoint and track upstream activity.
- Metadata risk: npm package omits explicit license field. Mitigation: track upstream repo license (MIT) and pin legal review note in dependency docs.

### Migration Path (if replacing)
1. Introduce an adapter layer for token exchange/refresh interfaces.
2. Port `lib/auth/auth.ts` flows to new library primitives.
3. Update callback parsing and token decoding tests.
4. Validate refresh queue behavior under race and retry scenarios.

## Capability: HTTP Server / Routing

### Candidates
| Package | Version | Downloads/wk | Last Commit/Publish | License | Stars |
|---|---:|---:|---|---|---:|
| `hono` | 4.12.3 | 23,472,737 | Published 2026-02-26; GitHub push 2026-02-26 | MIT | 29,085 |
| `express` | 5.2.1 | 78,993,523 | GitHub push 2026-02-23 | MIT | 68,833 |
| `fastify` | 5.7.4 | 5,513,136 | GitHub push 2026-02-28 | MIT | 35,701 |

### Recommendation
**Use**: `hono` `^4.12.3` (updated in this audit)

**Rationale**:
- Minimal migration cost because the codebase already depends on Hono abstractions.
- Security issue on prior range fixed by moving to patched version.
- Maintained and actively released with strong ecosystem adoption.

### Risks
- Historical advisory density exists across all web frameworks (including Hono). Mitigation: enforce `audit:ci`, keep pinned patched range, and monitor GHSA alerts.

### Migration Path (if replacing)
1. Replace router/server handlers in `lib/auth/server.ts` and related helpers.
2. Rework request/response adapter logic.
3. Update server unit/integration tests for framework-specific behaviors.

## Capability: Runtime Schema Validation

### Candidates
| Package | Version | Downloads/wk | Last Commit/Publish | License | Stars |
|---|---:|---:|---|---|---:|
| `zod` | 4.3.6 | 101,522,159 | GitHub push 2026-02-15 | MIT | 41,992 |
| `valibot` | 1.2.0 | 6,244,923 | GitHub push 2026-02-27 | MIT | 8,461 |
| `joi` | 18.0.2 | 17,311,481 | GitHub push 2025-11-19 | BSD-3-Clause | 21,200 |

### Recommendation
**Use**: keep `zod` `^4.3.6`

**Rationale**:
- Existing code and test suite are already Zod-centric (`lib/schemas.ts`), avoiding migration churn.
- Strong maintenance and adoption profile.
- MIT license aligns with policy.

### Risks
- Any validation library can have parser edge-case advisories over time. Mitigation: keep versions current and run dependency security checks in CI.

### Migration Path (if replacing)
1. Translate schema definitions and inferred TypeScript types.
2. Replace parse/validation error handling surfaces.
3. Revalidate all schema and transformer tests.

## Security History Snapshot
- OSV historical records were collected for all candidates (see `dependency-security-data.json`).
- Current project production graph is clean after remediation (`npm audit --omit=dev --json` shows 0 vulnerabilities).
- The prior Hono advisory (`GHSA-xh87-mx6m-69f3`) was the only production blocker on baseline and is fixed by the upgrade.

## Sources
- NPM package pages:
  - https://www.npmjs.com/package/@opencode-ai/plugin
  - https://www.npmjs.com/package/@opencode-ai/sdk
  - https://www.npmjs.com/package/@modelcontextprotocol/sdk
  - https://www.npmjs.com/package/@openauthjs/openauth
  - https://www.npmjs.com/package/openid-client
  - https://www.npmjs.com/package/oauth4webapi
  - https://www.npmjs.com/package/hono
  - https://www.npmjs.com/package/express
  - https://www.npmjs.com/package/fastify
  - https://www.npmjs.com/package/zod
  - https://www.npmjs.com/package/valibot
  - https://www.npmjs.com/package/joi
- NPM downloads API (last week):
  - https://api.npmjs.org/downloads/point/last-week/@opencode-ai%2Fplugin
  - https://api.npmjs.org/downloads/point/last-week/@opencode-ai%2Fsdk
  - https://api.npmjs.org/downloads/point/last-week/@modelcontextprotocol%2Fsdk
  - https://api.npmjs.org/downloads/point/last-week/@openauthjs%2Fopenauth
  - https://api.npmjs.org/downloads/point/last-week/openid-client
  - https://api.npmjs.org/downloads/point/last-week/oauth4webapi
  - https://api.npmjs.org/downloads/point/last-week/hono
  - https://api.npmjs.org/downloads/point/last-week/express
  - https://api.npmjs.org/downloads/point/last-week/fastify
  - https://api.npmjs.org/downloads/point/last-week/zod
  - https://api.npmjs.org/downloads/point/last-week/valibot
  - https://api.npmjs.org/downloads/point/last-week/joi
- GitHub repositories:
  - https://github.com/anomalyco/opencode
  - https://github.com/anomalyco/openauth
  - https://github.com/modelcontextprotocol/typescript-sdk
  - https://github.com/panva/openid-client
  - https://github.com/panva/oauth4webapi
  - https://github.com/honojs/hono
  - https://github.com/expressjs/express
  - https://github.com/fastify/fastify
  - https://github.com/colinhacks/zod
  - https://github.com/open-circle/valibot
  - https://github.com/hapijs/joi
- Security data:
  - https://osv.dev/list?ecosystem=npm&q=%40opencode-ai%2Fplugin
  - https://osv.dev/list?ecosystem=npm&q=%40opencode-ai%2Fsdk
  - https://osv.dev/list?ecosystem=npm&q=%40modelcontextprotocol%2Fsdk
  - https://osv.dev/list?ecosystem=npm&q=%40openauthjs%2Fopenauth
  - https://osv.dev/list?ecosystem=npm&q=openid-client
  - https://osv.dev/list?ecosystem=npm&q=oauth4webapi
  - https://osv.dev/list?ecosystem=npm&q=hono
  - https://osv.dev/list?ecosystem=npm&q=express
  - https://osv.dev/list?ecosystem=npm&q=fastify
  - https://osv.dev/list?ecosystem=npm&q=zod
  - https://osv.dev/list?ecosystem=npm&q=valibot
  - https://osv.dev/list?ecosystem=npm&q=joi
- Advisory fixed in this audit:
  - https://github.com/advisories/GHSA-xh87-mx6m-69f3
