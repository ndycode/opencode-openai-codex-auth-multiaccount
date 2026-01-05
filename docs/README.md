# Documentation

Welcome to the OpenCode OpenAI Codex Auth Plugin documentation!

## For Users

- **[Getting Started](../README.md)** - Installation, configuration, and quick start
- **[Configuration Guide](../README.md#configuration)** - Complete config reference
- **[Troubleshooting](../README.md#troubleshooting)** - Common issues and debugging
- **[Changelog](../CHANGELOG.md)** - Version history and release notes

## For Developers

Explore the engineering depth behind this plugin:

- **[Architecture](development/ARCHITECTURE.md)** - Technical design, request pipeline, AI SDK compatibility
- **[Configuration System](development/CONFIG_FLOW.md)** - How config loading and merging works
- **[Config Fields Guide](development/CONFIG_FIELDS.md)** - Understanding config keys, `id`, and `name`
- **[Testing Guide](development/TESTING.md)** - Test scenarios, verification procedures, integration testing

## Key Architectural Decisions

This plugin bridges two different systems with careful engineering:

1. **AI SDK Compatibility** - Filters `item_reference` (AI SDK construct) for Codex API compatibility
2. **Stateless Operation** - ChatGPT backend requires `store: false`, verified via testing
3. **Full Context Preservation** - Sends complete message history (IDs stripped) for LLM context
4. **15-Minute Caching** - Prevents GitHub API rate limit exhaustion
5. **Per-Model Configuration** - Enables quality presets with quick switching

**Testing**: 200+ unit tests + integration tests with actual API verification

---

**Quick Links**: [GitHub](https://github.com/ndycode/opencode-openai-codex-auth-multi) • [npm](https://www.npmjs.com/package/opencode-openai-codex-auth-multi) • [Issues](https://github.com/ndycode/opencode-openai-codex-auth-multi/issues)

