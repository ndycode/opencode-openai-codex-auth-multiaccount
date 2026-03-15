# Contributing

Thank you for contributing to `oc-chatgpt-multi-auth`.

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
6. **Run local validation**: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and `npm run docs:check` when docs or workflow files change
7. **Test thoroughly** with the most appropriate validation for the change, including real ChatGPT Plus/Pro checks when touching auth, request-routing, or storage behavior
8. **Complete the pull request template** with summary, testing, docs impact, and compliance details
9. **Submit PR** with clear description of changes

Pull requests are automatically screened for incomplete or suspicious submissions. Legitimate contributions are still welcome, but low-signal PRs may be flagged for maintainer review before they move forward.

If a PR is flagged incorrectly, a maintainer can override the workflow with the `exempt` label after review.

## CI and PR Checks

The repository uses split required and advisory PR lanes:

- Required code validation: `lint`, `typecheck`, `build`, `unit (linux)`, and `unit (windows)`
- Required conditional validation: `docs-sanity` for Markdown changes and `actionlint` for workflow changes
- Required policy checks: `required-pr` and `pr-governance`
- Advisory lanes: `coverage`, `compat-matrix`, and `dependency-audit`

`required-pr` is the aggregate gate that evaluates the required code, docs, and workflow jobs. `pr-governance` separately enforces the PR template and live-verification requirements for auth, request-routing, and storage changes. Maintainers can record an independent live check by applying the `maintainer-live-verified` label.

For maintainers, GitHub branch protection should require only:

- `required-pr`
- `pr-governance`

Advisory lanes should remain unrequired until their baselines are clean and stable.

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
