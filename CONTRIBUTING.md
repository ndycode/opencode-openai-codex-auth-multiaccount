# Contributing

Thank you for contributing to `oc-codex-multi-auth`.

This project accepts improvements that make the OpenCode plugin clearer, safer, easier to maintain, and more useful for personal development workflows.

## Compliance Requirements

All contributions MUST:

✅ **Maintain TOS Compliance**
- Use only official OAuth authentication methods
- Not facilitate violations of OpenAI's Terms of Service
- Focus on legitimate personal productivity use cases
- Include appropriate user warnings and disclaimers

✅ **Respect OpenAI's Systems**
- No session token scraping or cookie extraction
- No bypassing of rate limits or authentication controls
- No reverse-engineering of undocumented APIs
- Use only officially supported authentication flows

✅ **Proper Use Cases**
- Personal development and coding assistance
- Individual productivity enhancements
- Terminal-based workflows
- Educational purposes

❌ **Prohibited Features**
- Commercial resale or multi-user authentication
- Rate limit circumvention techniques
- Session token scraping or extraction
- Credential sharing mechanisms
- Features designed to violate OpenAI's terms

## Scope and Compliance

Contributions should stay within the project's intended scope:

- personal development workflows in OpenCode
- official OAuth authentication flows
- reliable GPT-5/Codex model support
- documentation, debugging, testing, and maintainability improvements

The project does not accept work aimed at:

- commercial resale or shared multi-user access
- bypassing safeguards, scraping sessions, or avoiding platform controls
- misleading documentation or exaggerated capability claims

## Code Standards

- **TypeScript:** All code must be TypeScript with strict type checking
- **Testing:** Include or update tests for behavioral changes
- **Documentation:** Update README.md for user-facing changes
- **Modular design:** Keep functions focused and easy to review
- **Dependencies:** Add new dependencies only when the benefit is clear

## Pull Request Process

1. **Fork the repository** and create a feature branch
2. **Write clear commit messages** explaining the "why" not just "what"
3. **Include tests** for new functionality
4. **Update documentation** (README.md, config examples, etc.)
5. **Ensure compliance** with guidelines above
6. **Test thoroughly** with the most appropriate validation for the change
7. **Complete the pull request template** with summary, testing, and compliance details
8. **Submit PR** with clear description of changes

Pull requests are automatically screened for incomplete or suspicious submissions. Legitimate contributions are still welcome, but low-signal PRs may be flagged for maintainer review before they move forward.

If a PR is flagged incorrectly, a maintainer can override the workflow with the `exempt` label after review.

## Reporting Issues

When reporting issues, please:

- **Check existing issues** to avoid duplicates
- **Provide clear reproduction steps**
- **Include version information** (`opencode --version`, plugin version)
- **Confirm compliance:** Verify you're using the plugin for personal use with your own subscription
- **Attach logs** (if using `ENABLE_PLUGIN_REQUEST_LOGGING=1`)

### Issue Template

Please include:
```
**Issue Description:**
[Clear description of the problem]

**Steps to Reproduce:**
1.
2.
3.

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happens]

**Environment:**
- opencode version:
- Plugin version:
- OS:
- Node version:

**Compliance Confirmation:**
- [ ] I'm using this for personal development only
- [ ] I have an active ChatGPT Plus/Pro subscription
- [ ] This is not related to commercial use or TOS violations
```

## Feature Requests

We welcome feature requests that:
- Enhance personal productivity
- Improve developer experience
- Maintain compliance with OpenAI's terms
- Align with the project's scope

We will decline features that:
- Violate or circumvent OpenAI's Terms of Service
- Enable commercial resale or multi-user access
- Bypass authentication or rate limiting
- Facilitate improper use

## Local Development

### Prerequisites
- Node.js ≥ 18 (LTS recommended)
- npm ≥ 9
- Git

### Setup
```bash
git clone https://github.com/ndycode/oc-codex-multi-auth.git
cd oc-codex-multi-auth
npm ci
```

### Run the quality gates locally
```bash
npm run typecheck  # strict TypeScript
npm run lint       # ESLint (no warnings allowed)
npm test           # Vitest full suite
npm run build      # Compile to dist/
```

### Run a focused test file
```bash
npx vitest run test/circuit-breaker-wiring.test.ts
```

### Iterative test watch mode
```bash
npx vitest watch
```

### Husky hooks
Commits go through:
- `pre-commit` — lint-staged on changed files
- `commit-msg` — Conventional Commits regex

To skip hooks temporarily (discouraged):
```bash
git commit --no-verify -m "..."
```

### How to add a test
Match the closest existing test file under `test/`. For a new `lib/<module>.ts`, add `test/<module>.test.ts`. Follow the Vitest + Zod + fake-timer conventions in existing tests (see `test/rotation.test.ts` for a mid-complexity example).

### Updating API contract fixtures

Contract tests in `test/contracts/` pin external API response shapes (OAuth token endpoint, Codex non-streaming chat-completions, Codex SSE stream). They read sanitized fixtures from `test/contracts/fixtures/` and feed them through the SAME production parsers and schemas the plugin uses at runtime (`OAuthTokenResponseSchema`, `isEmptyResponse`, `convertSseToJson`). A failing contract test means the upstream shape drifted or the parser was changed in a way that no longer accepts a known-good response.

**When to update:**
- An upstream API release changes the response shape.
- You want to capture a new edge case (e.g., a new `reasoning.encrypted_content` variant or a new SSE event).

**How to update:**
1. Capture a real response from the live endpoint while debugging. **Sanitize every token, account id, organization id, email, and JWT** — replace them with `FAKE_*` placeholders matching the style of the existing fixtures.
2. Update the fixture file under `test/contracts/fixtures/` with the sanitized payload.
3. Run the contract test (`npx vitest run test/contracts/`). A pass means the new fixture is compatible with production parsers; a failure means either the fixture or the parser needs to change.
4. If the upstream added a new optional field, no code change is required — the existing schema will accept it and the test will still pass.
5. If the upstream change is backward-incompatible, update the production parser AND the contract test in the same commit so the two stay in sync.

**Never commit real tokens, real account ids, real organization ids, real JWT payloads, or any PII in fixtures.** The fixtures live in version control; treat them as public.

### Debug OAuth flow locally
Set `CODEX_DEBUG_AUTH=1` in your shell before running. See `docs/development/ARCHITECTURE.md#oauth-flow` for protocol details.

### Testing the OS-keychain backend

`lib/storage/keychain.ts` implements the opt-in keychain credential backend. Contract tests (`test/storage-keychain.test.ts`) use an in-memory mock via `_setBackendForTests` so CI never touches the real OS keychain.

To exercise the real keychain locally, unset the mock and run against your actual OS keychain:

```bash
CODEX_KEYCHAIN=1 npm test -- test/storage-keychain.test.ts
```

Real-keychain runs will create and delete throwaway entries under the service name `oc-codex-multi-auth` with account keys prefixed `accounts:`. The tests clean up after themselves, but if a run is aborted you can verify and remove leftover entries:

- macOS: Keychain Access.app, search for `oc-codex-multi-auth`
- Windows: `rundll32.exe keymgr.dll, KRShowKeyMgr` or `cmdkey /list`
- Linux: `secret-tool search service oc-codex-multi-auth` (requires `libsecret-tools`)

Never check real refresh tokens, access tokens, or account ids into tests or fixtures.

## Code of Conduct

All contributors are expected to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Questions?

For questions about:
- **Plugin usage:** open a GitHub issue
- **OpenAI's terms:** contact OpenAI support
- **Contributing:** open an issue describing the proposed change

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)).

---

Thank you for helping make this plugin better while maintaining compliance and ethics!
