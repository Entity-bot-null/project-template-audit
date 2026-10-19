import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exampleDatabaseUrl } from '../../../../scripts/examples.mjs';

// The connected example (`pnpm examples generate --kind web`, then its
// `pnpm build`) for the cross suite: its built API, started by a spec once
// Audit Hub has shown the variables to connect it, on ports and a database of
// its own, apart from Audit Hub's end-to-end ones.

export const EXAMPLE_DIR = fileURLToPath(new URL('../../../../.examples/web', import.meta.url));
export const EXAMPLE_API_PORT = 3410;
export const EXAMPLE_WEB_URL = 'http://localhost:4373';

/** The NAME=value lines Audit Hub's admin pages show once. */
export function variablesOf(text: string): Record<string, string> {
  const variables = Object.fromEntries(
    text
      .split('\n')
      .map((line) => /^(AUDIT_HUB_[A-Z_]+)=(.*)$/.exec(line.trim()))
      .filter((match) => match !== null)
      .map((match) => [match[1] ?? '', match[2] ?? '']),
  );
  if (variables.AUDIT_HUB_KEY_SECRET === undefined) throw new Error('No variables shown');
  return variables;
}

export interface ExampleApi {
  stop(): Promise<void>;
}

/**
 * The example's API as its own end-to-end suite runs it (its template's
 * scripts/e2e-server.mjs: `example_web_e2e` migrated, emptied and seeded, the
 * built API in production mode), connected to Audit Hub with `variables`.
 */
export async function startExampleApi(variables: Record<string, string>): Promise<ExampleApi> {
  // On the server Audit Hub's suite uses (CI sets DATABASE_URL), never on its database.
  const base = new URL(process.env.DATABASE_URL ?? exampleDatabaseUrl('example_web'));
  base.pathname = '/example_web';
  const api: ChildProcess = spawn(process.execPath, ['scripts/e2e-server.mjs'], {
    cwd: `${EXAMPLE_DIR}/apps/api`,
    env: {
      ...process.env,
      ...variables,
      DATABASE_URL: base.toString(),
      PORT: String(EXAMPLE_API_PORT),
      APP_ORIGIN: EXAMPLE_WEB_URL,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const exited = new Promise<void>((resolve) => {
    api.once('exit', () => {
      resolve();
    });
  });
  const ready = `http://127.0.0.1:${String(EXAMPLE_API_PORT)}/api/health/ready`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (api.exitCode !== null)
      throw new Error(`The example's API exited (${String(api.exitCode)})`);
    try {
      if ((await fetch(ready)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      api.kill('SIGTERM');
      throw new Error(`The example's API was not ready at ${ready}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    async stop() {
      if (api.exitCode === null) api.kill('SIGTERM');
      await exited;
    },
  };
}
