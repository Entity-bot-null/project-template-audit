import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { EXAMPLE_API_PORT, EXAMPLE_DIR, EXAMPLE_WEB_URL } from './e2e/support/example.js';

// The cross suite (docs/adr/0010): Audit Hub and the connected example
// project in real browsers, each built and on its own ports and database.
// Audit Hub's API and both web apps start here; the example's API starts in
// the spec, once Audit Hub has shown the variables that connect it. Needs
// `pnpm build`, `pnpm examples generate --kind web` and `pnpm build` in
// .examples/web, the database (`pnpm db:up`) and the browser once.
const CI = process.env.CI !== undefined;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HUB_API_PORT = 3300;
const HUB_WEB_URL = 'http://localhost:4273';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: '../../playwright-report/examples-web' }],
      ]
    : [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/examples-web' }]],
  outputDir: '../../test-results/examples-web',
  use: {
    baseURL: HUB_WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter api e2e:server',
      cwd: ROOT,
      url: `http://127.0.0.1:${String(HUB_API_PORT)}/api/health/ready`,
      env: { PORT: String(HUB_API_PORT), APP_ORIGIN: HUB_WEB_URL },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter web preview',
      cwd: ROOT,
      url: HUB_WEB_URL,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${String(HUB_API_PORT)}` },
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      // The example's built web app, /api forwarded to its API (started by the spec).
      command: `pnpm --filter web preview --port ${new URL(EXAMPLE_WEB_URL).port}`,
      cwd: EXAMPLE_DIR,
      url: EXAMPLE_WEB_URL,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${String(EXAMPLE_API_PORT)}` },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
