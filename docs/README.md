# Documentation

Welcome to the OpenCode OpenAI Codex Auth Plugin documentation.

## For Users

- **[Getting Started](getting-started.md)** - Installation, configuration, and quick start
- **[Configuration Guide](configuration.md)** - Complete config reference
- **[Troubleshooting](troubleshooting.md)** - Common issues and debugging
- **[Changelog](../CHANGELOG.md)** - Version history and release notes

## For Developers

Explore the engineering depth behind this plugin:

- **[Architecture](development/ARCHITECTURE.md)** - Technical design, request transform modes, AI SDK compatibility
- **[Configuration System](development/CONFIG_FLOW.md)** - How config loading and merging works
- **[Config Fields Guide](development/CONFIG_FIELDS.md)** - Understanding config keys, `id`, and `name`
- **[Testing Guide](development/TESTING.md)** - Test scenarios, verification procedures, integration testing
- **[TUI Parity Checklist](development/TUI_PARITY_CHECKLIST.md)** - Auth dashboard/UI parity requirements for future changes

## Key Architectural Decisions

This plugin bridges OpenCode and the ChatGPT Codex backend with explicit mode controls:

1. **Request Transform Mode Split** - `native` mode (default) preserves OpenCode payload shape; `legacy` mode applies Codex compatibility rewrites.
2. **Stateless Operation** - ChatGPT backend requires `store: false`, verified via testing.
3. **Full Context Preservation** - Sends complete message history and always includes `reasoning.encrypted_content`.
4. **Stale-While-Revalidate Caching** - Keeps prompt/instruction fetches fast while avoiding GitHub rate limits; optional startup prewarm for first-turn latency.
5. **Per-Model Configuration** - Enables quality presets with quick switching.
6. **Fast Session Mode** - Optional low-latency tuning (clamps reasoning/verbosity on trivial turns) without changing defaults.
7. **Entitlement-Aware Fallback Flow** - Unsupported models try remaining accounts/workspaces first, then optional fallback chain if enabled.
8. **Beginner Operations Layer** - Setup checklist/wizard, guided doctor flow, next-step recommender, and startup preflight summaries.
9. **Safety-First Account Backup Flow** - Timestamped exports, import dry-run previews, and pre-import snapshots before apply when existing accounts are present.

**Testing**: 1,756 tests plus integration coverage.

---

**Quick Links**: [GitHub](https://github.com/ndycode/oc-chatgpt-multi-auth) | [npm](https://www.npmjs.com/package/oc-chatgpt-multi-auth) | [Issues](https://github.com/ndycode/oc-chatgpt-multi-auth/issues)
