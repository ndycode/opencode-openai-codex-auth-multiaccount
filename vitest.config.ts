import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      '.opencode/**',
      'dist/**',
      'tmp/**',
      '**/node_modules/**',
      '**/.opencode/**',
      '**/dist/**',
      '**/tmp/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'test/'],
      thresholds: {
        // Global coverage floor.
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
        // Per-file coverage floor for the production source tree. Set below the
        // global average so legitimate low-coverage utility files do not block
        // work, while still catching regressions where a single file drops
        // sharply. Track increases in
        // https://github.com/ndycode/oc-codex-multi-auth/issues/149.
        'lib/**/*.ts': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'index.ts': {
          statements: 69,
          branches: 50,
          functions: 70,
          lines: 70,
        },
      },
    },
  },
});

