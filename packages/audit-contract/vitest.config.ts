import { defineConfig } from 'vitest/config';

// The contract is copied into connected projects (docs/adr/0009), whose
// coverage thresholds are the strictest in the family: those apply here.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/testing/**', 'src/index.ts', 'src/node/index.ts'],
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      thresholds: {
        lines: 97,
        functions: 94,
        branches: 90,
        statements: 96,
      },
    },
  },
});
