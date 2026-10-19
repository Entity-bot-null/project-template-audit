import { defineConfig } from 'vitest/config';

// The connector is copied into connected projects (docs/adr/0009) and must
// pass their gates as their own code: the API template's thresholds apply,
// raised to the contract's. The test doubles of the project (host.ts,
// audit.wiring.ts) are not part of what is installed.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/audit/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/audit/contract/**',
        'src/audit/host.ts',
        'src/audit/audit.wiring.ts',
        // Wiring: routes and the module graph, covered by the example's
        // integration specs (docs/adr/0010), as in the API template.
        'src/audit/**/*.controller.ts',
        'src/audit/**/*.module.ts',
      ],
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      // Ratchet: the coverage measured, rounded down; raise it as it grows.
      thresholds: {
        lines: 99,
        functions: 99,
        branches: 98,
        statements: 99,
      },
    },
  },
});
