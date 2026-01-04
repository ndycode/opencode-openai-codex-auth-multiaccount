# Test Suite

This directory contains the comprehensive test suite for the OpenAI Codex OAuth plugin.

## Test Structure

```
test/
├── README.md                      # This file
├── auth.test.ts                   # OAuth authentication tests
├── config.test.ts                 # Configuration parsing tests
├── logger.test.ts                 # Logging functionality tests
├── request-transformer.test.ts    # Request transformation tests
└── response-handler.test.ts       # Response handling tests
```

## Running Tests

```bash
# Run all tests once
npm test

# Watch mode (re-run on file changes)
npm run test:watch

# Visual test UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## Test Coverage

### auth.test.ts (16 tests)
Tests OAuth authentication functionality:
- State generation and uniqueness
- Authorization input parsing (URL, code#state, query string formats)
- JWT decoding and payload extraction
- Authorization flow creation with PKCE
- URL parameter validation

### config.test.ts (13 tests)
Tests configuration parsing and merging:
- Global configuration application
- Per-model configuration overrides
- Mixed configuration (global + per-model)
- Default values and fallbacks
- Reasoning effort normalization (minimal → low for codex)
- Lightweight model detection (nano, mini)

### request-transformer.test.ts (30 tests)
Tests request body transformations:
- Model name normalization (all variants → gpt-5 or gpt-5-codex)
- Input filtering (removing stored conversation history)
- Tool remap message injection
- Reasoning configuration application
- Text verbosity settings
- Encrypted reasoning content inclusion
- Unsupported parameter removal

### response-handler.test.ts (10 tests)
Tests SSE to JSON conversion:
- Content-type header management
- SSE stream parsing (response.done, response.completed)
- Malformed JSON handling
- Empty stream handling
- Status preservation

### logger.test.ts (5 tests)
Tests logging functionality:
- LOGGING_ENABLED constant
- logRequest function parameter handling
- Complex data structure support

## Test Philosophy

1. **Comprehensive Coverage**: Each module has extensive tests covering normal cases, edge cases, and error conditions
2. **Fast Execution**: All tests run in < 250ms
3. **No External Dependencies**: Tests use mocked data and don't make real API calls
4. **Type Safety**: All tests are written in TypeScript with full type checking

## CI/CD Integration

Tests automatically run in GitHub Actions on:
- Every push to main
- Every pull request

The CI workflow tests against multiple Node.js versions (18.x, 20.x, 22.x) to ensure compatibility.

## Adding New Tests

When adding new functionality:

1. Create or update the relevant test file
2. Follow the existing pattern using vitest's `describe` and `it` blocks
3. Ensure tests are isolated and don't depend on external state
4. Run `npm test` to verify all tests pass
5. Run `npm run typecheck` to ensure TypeScript types are correct

## Example Configurations

See the `config/` directory for working configuration examples:
- `minimal-opencode.json`: Simplest setup with defaults
- `opencode-legacy.json`: Legacy complete example with all model variants
- `opencode-modern.json`: Variant-based example for OpenCode v1.0.210+
