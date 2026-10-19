import { defineConfig } from 'vitest/config';

// The connector is copied into apps created from project-template-app
// (docs/adr/0009) and its specs run there under Jest: they use only the
// globals both runners have (describe, it, expect, beforeEach, afterEach)
// and injected fakes, never vi.* or jest.*. The app template's thresholds
// apply, raised to the contract's.
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/audit/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/audit/contract/**',
        // React hooks over queries.ts: rendered by the app example's screen
        // specs (docs/adr/0010), as the API's controllers are.
        'src/audit/hooks.ts',
      ],
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      // Ratchet: the coverage measured, rounded down; raise it as it grows.
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
