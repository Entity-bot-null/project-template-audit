import { defineConfig } from 'vitest/config';

// The connector is copied into web apps created from project-template-web
// (docs/adr/0009), whose Vitest runs its specs: a DOM (jsdom), as there. The
// web template's thresholds apply, raised to the contract's.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/audit/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/audit/contract/**'],
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
