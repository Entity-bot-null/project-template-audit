// The panel asks browsers for the client hints Audit Hub records with its own
// events (docs/security.md#who-may-sign-in): the same list in production
// (nginx), in development and in the end-to-end suite (Vite), as the contract
// names it (ACCEPT_CLIENT_HINTS). Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (/** @type {string} */ path) => readFileSync(join(ROOT, path), 'utf8');

const contract = /ACCEPT_CLIENT_HINTS =\s*'([^']+)'/.exec(
  read('packages/audit-contract/src/client-hints.ts'),
)?.[1];

test('the contract names the client hints a page asks for', () => {
  assert.equal(
    contract,
    'Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model',
  );
});

test('nginx asks for them on every page it serves', () => {
  const headers = read('apps/web/nginx/security-headers.conf');
  assert.match(headers, new RegExp(`add_header Accept-CH "${contract}" always;`));
});

test('the Vite server and preview ask for the same ones', () => {
  const config = read('apps/web/vite.config.ts');
  assert.ok(config.includes(`'Accept-CH': '${contract}'`));
  assert.equal(config.match(/headers: clientHints,/g)?.length, 2);
});
