# Configuration Examples

This directory contains example opencode configuration files for the OpenAI Codex OAuth plugin.

## Files

### minimal-opencode.json
The simplest possible configuration using plugin defaults.

```bash
cp config/minimal-opencode.json ~/.config/opencode/opencode.json
```

This uses default settings:
- `reasoningEffort`: "medium"
- `reasoningSummary`: "auto"
- `textVerbosity`: "medium"
- `include`: ["reasoning.encrypted_content"]
- `store`: false (required for AI SDK 2.0.50+ compatibility)

### full-opencode.json
Complete configuration example showing all model variants with custom settings.

```bash
cp config/full-opencode.json ~/.config/opencode/opencode.json
```

This demonstrates:
- Global options for all models
- Per-model configuration overrides
- All supported model variants (gpt-5-codex, gpt-5-codex-mini, gpt-5, gpt-5-mini, gpt-5-nano)

## Usage

1. Choose a configuration file based on your needs
2. Copy it to your opencode config directory:
   - Global: `~/.config/opencode/opencode.json`
   - Project: `<project>/.opencode.json`
3. Modify settings as needed
4. Run opencode: `opencode run "your prompt"`

## Configuration Options

See the main [README.md](../README.md#configuration) for detailed documentation of all configuration options.
