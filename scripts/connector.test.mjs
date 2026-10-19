// Tests of scripts/connector.mjs (`pnpm connector`): what a version of the
// connector installs, `add` into a project, the Prisma schema edits, and
// `status`, `diff` and `update` against a newer Audit Hub. Each project is a
// throwaway folder with only what the connector reads (the API's Prisma
// schema); a newer Audit Hub is a copy of the packages with files changed.
// Prisma is a recording stand-in: the real migration needs the project's
// dependencies (`pnpm connector migration`). Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  add,
  adaptersOf,
  addModels,
  compareVersions,
  diff,
  EXPO_CONTRACT_FILES,
  extrasOf,
  forBundler,
  HUB_ONLY_CONTRACT_FILES,
  KINDS,
  MANIFEST,
  migration,
  nextSteps,
  payloadOf,
  PRISTINE_DIR,
  readManifest,
  SPA_CONTRACT_FILES,
  status,
  update,
  walk,
  withBackRelations,
  withoutConnector,
  writeMigration,
} from './connector.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'connector-test-'));
let counter = 0;

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const API = /** @type {import('./connector.mjs').Kind} */ (KINDS.api);
const CORE = 'apps/api/src/audit';
const SCHEMA = 'apps/api/prisma/schema.prisma';
const PACKAGE = 'packages/audit-nestjs';
const BEGIN = '// audit-connector:begin';
const END = '// audit-connector:end';
const BACK_RELATION =
  '  auditSecurityPrompts AuditSecurityPrompt[] // audit-connector\n  auditPushTokens AuditPushToken[] // audit-connector';
const NOW = new Date('2026-10-15T12:34:56.789Z');

/** A project's schema: a model named like User before it, a relation to it after. */
const PROJECT_SCHEMA = `generator client {
  provider = "prisma-client"
  output   = "../src/prisma/generated"
}

datasource db {
  provider = "postgresql"
}

model UserSettings {
  id String @id
}

model User {
  id       String    @id @default(uuid(7)) @db.Uuid
  email    String    @unique
  sessions Session[]

  @@map("users")
}

model Session {
  id     String @id
  userId String
  user   User   @relation(fields: [userId], references: [id])
}
`;

/** A core file with lines far enough apart to merge edits made on both sides. */
const SAMPLE = Array.from({ length: 12 }, (_, index) => index + 1)
  .map((line) => `export const line${String(line)} = ${String(line)};\n`)
  .join('');

const sha256 = (/** @type {string} */ content) =>
  createHash('sha256').update(content).digest('hex');

/**
 * @param {string} dir
 * @param {string} path
 */
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');

/**
 * @param {string} dir
 * @param {string} path
 * @param {string} content
 */
function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

/**
 * Replaces `from` with `to` in a file, which must contain it.
 * @param {string} dir
 * @param {string} path
 * @param {string} from
 * @param {string} to
 */
function edit(dir, path, from, to) {
  const content = read(dir, path);
  assert.ok(content.includes(from), `${path} has no ${from}`);
  writeFileSync(
    join(dir, path),
    content.replace(from, () => to),
  );
}

/** @param {string} dir */
function manifestOf(dir) {
  const manifest = readManifest(dir);
  assert.ok(manifest !== undefined, `${dir} has no ${MANIFEST}`);
  return manifest;
}

/** @param {string} file */
const pristine = (file) => join(PRISTINE_DIR, 'pristine', `${file}.orig`);

/** A project created from the templates, as far as the connector reads it. */
function project() {
  counter += 1;
  const dir = join(TMP, `project-${String(counter)}`);
  write(dir, SCHEMA, PROJECT_SCHEMA);
  return dir;
}

/**
 * A copy of Audit Hub's packages as the connector reads them, at `version`,
 * with SAMPLE among the core files: change it to make a newer version.
 * @param {string} [version]
 */
function hub(version = '1.0.0') {
  counter += 1;
  const dir = join(TMP, `hub-${String(counter)}`);
  for (const path of [
    `${PACKAGE}/package.json`,
    `${PACKAGE}/src/audit`,
    `${PACKAGE}/install/api`,
    'packages/audit-contract/src',
  ]) {
    cpSync(join(REPO, path), join(dir, path), { recursive: true });
  }
  write(dir, `${PACKAGE}/src/audit/sample.ts`, SAMPLE);
  release(dir, version);
  return dir;
}

/**
 * Sets the connector's version in a copy of the packages.
 * @param {string} dir
 * @param {string} version
 */
function release(dir, version) {
  const pkg = JSON.parse(read(dir, `${PACKAGE}/package.json`));
  write(dir, `${PACKAGE}/package.json`, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
}

/** A project with the connector installed from a copy of the packages, at 1.0.0. */
function installed() {
  const target = project();
  const source = hub();
  add(target, 'api', { hub: source, migration: false });
  return { target, hub: source };
}

/**
 * Puts a stand-in for Prisma's CLI where the project's dependencies would
 * have it: it keeps its arguments and the schema before, and answers SQL.
 * @param {string} dir
 */
function installPrisma(dir) {
  const bin = 'apps/api/node_modules/.bin/prisma';
  write(
    dir,
    bin,
    `#!/bin/sh
printf '%s\\n' "$@" > prisma-args.txt
cp "$4" prisma-before.prisma
echo 'CREATE TABLE "audit_outbox" ();'
`,
  );
  chmodSync(join(dir, bin), 0o755);
}

/** The migration the stand-in makes with the connector's own SQL. */
const expectedMigration = (/** @type {string} */ source) =>
  `${['CREATE TABLE "audit_outbox" ();', ...extrasOf(API, source)].join('\n\n')}\n`;

describe('walk', () => {
  test('every file below, with "/" separators, sorted', () => {
    const dir = join(TMP, 'walk');
    write(dir, 'b.ts', '');
    write(dir, 'a/z.ts', '');
    write(dir, 'a/b/c.ts', '');
    mkdirSync(join(dir, 'empty'));
    assert.deepEqual(walk(dir), ['a/b/c.ts', 'a/z.ts', 'b.ts']);
  });
});

describe('payloadOf and adaptersOf', () => {
  const source = join(REPO, PACKAGE, 'src/audit');
  const contract = join(REPO, 'packages/audit-contract/src');
  const payload = payloadOf(API);
  const adapters = adaptersOf(API);

  test("the connector's sources go to the API, without its test doubles or its contract shim", () => {
    assert.ok(payload.has(`${CORE}/audit.module.ts`));
    for (const file of walk(source)) {
      if (API.doubles.includes(file)) {
        assert.equal(payload.has(`${CORE}/${file}`), false, file);
      } else if (!file.startsWith('contract/')) {
        assert.equal(payload.get(`${CORE}/${file}`), readFileSync(join(source, file), 'utf8'));
      }
    }
    // The shim re-exports the package 'audit-contract'; the project gets its source instead.
    assert.doesNotMatch(payload.get(`${CORE}/contract/index.ts`) ?? '', /from 'audit-contract'/);
    for (const file of payload.keys()) assert.ok(file.startsWith(`${CORE}/`), file);
  });

  test('the contract is vendored under contract/, its index exporting the Node.js part too', () => {
    const index = readFileSync(join(contract, 'index.ts'), 'utf8');
    const vendored = payload.get(`${API.contractTarget}/index.ts`) ?? '';
    assert.ok(vendored.startsWith(`${index.trimEnd()}\n`));
    assert.ok(vendored.endsWith("\nexport * from './node/index.js';\n"));
    for (const file of walk(contract)) {
      if (file === 'index.ts' || HUB_ONLY_CONTRACT_FILES.includes(file)) continue;
      assert.equal(
        payload.get(`${API.contractTarget}/${file}`),
        readFileSync(join(contract, file), 'utf8'),
      );
    }
    assert.ok(payload.has(`${API.contractTarget}/node/index.ts`));
  });

  test("Audit Hub's JSON Schema generator and its drift check stay behind", () => {
    for (const file of ['json-schemas.ts', 'json-schemas.spec.ts']) {
      assert.ok(existsSync(join(contract, file)), file);
      assert.equal(payload.has(`${CORE}/contract/${file}`), false, file);
    }
  });

  test("the adapters' templates, each where a test double was left out", () => {
    const dir = join(REPO, PACKAGE, 'install/api/src/audit');
    assert.deepEqual(
      [...adapters.keys()],
      walk(dir).map((file) => `${CORE}/${file}`),
    );
    for (const [file, content] of adapters) {
      assert.equal(content, readFileSync(join(dir, file.slice(CORE.length + 1)), 'utf8'));
      assert.equal(payload.has(file), false, `${file} is both installed and an adapter`);
    }
    for (const double of API.doubles) assert.ok(adapters.has(`${CORE}/${double}`), double);
  });
});

describe('the Expo kind', () => {
  const EXPO = /** @type {import('./connector.mjs').Kind} */ (KINDS.expo);
  const APP_CORE = 'src/lib/audit';
  const CONTRACT = 'src/lib/audit/contract';
  const source = join(REPO, 'packages/audit-expo/src/audit');
  const payload = payloadOf(EXPO);
  const adapters = adaptersOf(EXPO);
  /** The relative imports of a file: from '…', import '…', export … from '…'. */
  const importsOf = (/** @type {string} */ text) =>
    [...text.matchAll(/(?:from|import) '(\.{1,2}\/[^']+)'/g)].map((match) => match[1] ?? '');

  test("the connector's sources go to src/lib/audit, without its contract shim", () => {
    for (const file of walk(source)) {
      if (file.startsWith('contract/')) continue;
      assert.equal(payload.get(`${APP_CORE}/${file}`), readFileSync(join(source, file), 'utf8'));
    }
    assert.doesNotMatch(payload.get(`${CONTRACT}/index.ts`) ?? '', /audit-contract'/);
  });

  test('its part of the contract, imported without extensions and with an index of its own', () => {
    const contractFiles = [...payload.keys()]
      .filter((file) => file.startsWith(`${CONTRACT}/`))
      .map((file) => file.slice(CONTRACT.length + 1))
      .sort();
    assert.deepEqual(contractFiles, [...EXPO_CONTRACT_FILES, 'index.ts'].sort());
    const index = payload.get(`${CONTRACT}/index.ts`) ?? '';
    for (const file of EXPO_CONTRACT_FILES) {
      const content = payload.get(`${CONTRACT}/${file}`) ?? '';
      assert.doesNotMatch(content, /from '\.{1,2}\/[^']*\.js'/, file);
      // Specs run under Jest in the app: no vitest, no vi.*.
      assert.doesNotMatch(content, /vitest|\bvi\./, file);
      const exported = index.includes(`export * from './${file.replace(/\.ts$/, '')}';`);
      assert.equal(exported, !file.endsWith('.spec.ts') && !file.startsWith('testing/'), file);
    }
  });

  test('every import of the core and of its contract resolves inside what is installed', () => {
    for (const [file, content] of payload) {
      for (const path of importsOf(content)) {
        const target = join(dirname(file), path).split('\\').join('/');
        const found = [`${target}.ts`, `${target}/index.ts`].some((candidate) =>
          payload.has(candidate),
        );
        assert.ok(found, `${file} imports ${path}, which the app does not get`);
      }
    }
  });

  test('a contract file as an app reads it', () => {
    assert.equal(
      forBundler(
        'a.spec.ts',
        "import { describe, expect, it } from 'vitest';\nimport { x } from './x.js';\nexport * from '../y.js';\nimport z from 'zod';\n",
      ),
      "import { x } from './x';\nexport * from '../y';\nimport z from 'zod';\n",
    );
    assert.equal(
      forBundler('a.ts', "import { describe } from 'vitest';\n"),
      "import { describe } from 'vitest';\n",
    );
    // For Vitest (the SPA): the specs keep it.
    assert.equal(
      forBundler('a.spec.ts', "import { it } from 'vitest';\nimport { x } from './x.js';\n", {
        jest: false,
      }),
      "import { it } from 'vitest';\nimport { x } from './x';\n",
    );
  });

  test("the adapters go where the app's layers want them", () => {
    assert.deepEqual([...adapters.keys()].sort(), [
      'src/api/audit.ts',
      'src/lib/audit/audit.int.spec.ts',
      'src/lib/audit/audit.wiring.ts',
      'src/lib/storage/auditQueue.ts',
    ]);
    for (const file of adapters.keys()) assert.equal(payload.has(file), false, file);
  });

  test('the events name the version of the package that sent them', () => {
    const pkg = JSON.parse(read(REPO, 'packages/audit-expo/package.json'));
    assert.match(
      read(REPO, 'packages/audit-expo/src/audit/audit.constants.ts'),
      new RegExp(`version: '${String(pkg.version).replaceAll('.', '\\.')}'`),
    );
  });

  test('add installs it into an app, with no schema to touch, and says what is left', () => {
    const target = join(TMP, `app-${String((counter += 1))}`);
    mkdirSync(target, { recursive: true });
    const result = add(target, 'expo');
    assert.equal(result.schemaChanged, false);
    assert.equal(result.migration, undefined);
    assert.equal(manifestOf(target).kind, 'expo');
    for (const [file, content] of payload) assert.equal(read(target, file), content, file);
    for (const [file, content] of adapters) assert.equal(read(target, file), content, file);
    const steps = nextSteps(result);
    assert.match(steps, /^Installed audit-expo /);
    assert.match(steps, /expo install expo-crypto/);
    assert.match(steps, /connection-guide\.md#the-mobile-app/);
    assert.deepEqual(status(target).modified, []);
  });
});

describe('the SPA kind', () => {
  const SPA = /** @type {import('./connector.mjs').Kind} */ (KINDS.spa);
  const CONTRACT = 'src/audit/contract';
  const payload = payloadOf(SPA);
  const adapters = adaptersOf(SPA);

  test("the reporter and its part of the contract go to the web app's src/audit, specs for Vitest", () => {
    const contractFiles = [...payload.keys()]
      .filter((file) => file.startsWith(`${CONTRACT}/`))
      .map((file) => file.slice(CONTRACT.length + 1))
      .sort();
    assert.deepEqual(contractFiles, [...SPA_CONTRACT_FILES, 'index.ts'].sort());
    for (const file of SPA_CONTRACT_FILES) {
      const content = payload.get(`${CONTRACT}/${file}`) ?? '';
      assert.doesNotMatch(content, /from '\.{1,2}\/[^']*\.js'/, file);
      if (file.endsWith('.spec.ts')) assert.match(content, /from 'vitest';/, file);
    }
    assert.ok(payload.has('src/audit/reporter.ts'));
    for (const file of payload.keys()) assert.ok(file.startsWith('src/audit/'), file);
  });

  test('every import of the reporter and of its contract resolves inside what is installed', () => {
    for (const [file, content] of payload) {
      for (const match of content.matchAll(/(?:from|import) '(\.{1,2}\/[^']+)'/g)) {
        const target = join(dirname(file), match[1] ?? '')
          .split('\\')
          .join('/');
        assert.ok(
          [`${target}.ts`, `${target}/index.ts`].some((candidate) => payload.has(candidate)),
          `${file} imports ${match[1]}`,
        );
      }
    }
  });

  test('the lazy reporter imports no schema of the contract: types and UUIDv7 only', () => {
    const reporter = payload.get('src/audit/reporter.ts') ?? '';
    const imports = [...reporter.matchAll(/^import (type )?.*from '(\.\/contract[^']*)';$/gm)];
    assert.deepEqual(
      imports.map((match) => [match[1] === 'type ', match[2]]),
      [
        [true, './contract'],
        [false, './contract/uuidv7'],
      ],
    );
  });

  test("the adapter and its spec go to the web app's src/audit", () => {
    assert.deepEqual([...adapters.keys()].sort(), [
      'src/audit/audit.wiring.spec.ts',
      'src/audit/audit.wiring.ts',
    ]);
  });

  test('the events name the version of the package that sent them', () => {
    const pkg = JSON.parse(read(REPO, 'packages/audit-web/package.json'));
    assert.match(
      read(REPO, 'packages/audit-web/src/audit/audit.constants.ts'),
      new RegExp(`version: '${String(pkg.version).replaceAll('.', '\\.')}'`),
    );
  });

  test('add installs it, and says what is left', () => {
    const target = join(TMP, `web-${String((counter += 1))}`);
    mkdirSync(target, { recursive: true });
    const result = add(target, 'spa');
    assert.equal(result.migration, undefined);
    for (const [file, content] of payload) assert.equal(read(target, file), content, file);
    const steps = nextSteps(result);
    assert.match(steps, /^Installed audit-web /);
    assert.match(steps, /auditClientEvents/);
    assert.match(steps, /connection-guide\.md#the-web-app/);
  });
});

describe('withBackRelations and withoutConnector', () => {
  test("adds the marked back-relation as model User's last field, and nowhere else", () => {
    const schema = withBackRelations(PROJECT_SCHEMA);
    assert.equal(
      schema,
      PROJECT_SCHEMA.replace('  @@map("users")\n}', `  @@map("users")\n${BACK_RELATION}\n}`),
    );
  });

  test('a schema without model User is refused', () => {
    assert.throws(
      () => withBackRelations('model UserSettings {\n  id String @id\n}\n'),
      /No model User in the Prisma schema/,
    );
  });

  test('removing the connector gives the schema back as it was before add', () => {
    const target = project();
    assert.equal(addModels(API, target), PROJECT_SCHEMA);
    const schema = read(target, SCHEMA);
    assert.ok(schema.includes(BEGIN) && schema.includes(END) && schema.includes(BACK_RELATION));
    const without = withoutConnector(schema);
    assert.equal(without, PROJECT_SCHEMA);
    assert.doesNotMatch(without, /audit-connector|AuditOutbox|auditSecurityPrompts/);
  });

  test('a schema without the connector is left alone; marked lines go wherever they are', () => {
    assert.equal(withoutConnector(PROJECT_SCHEMA), PROJECT_SCHEMA);
    assert.equal(
      withoutConnector('model Note {\n  id String @id\n  extra Int // audit-connector  \n}\n'),
      'model Note {\n  id String @id\n}\n',
    );
  });
});

describe('add', () => {
  test('installs the payload, the adapters, the models, a manifest and pristine copies', () => {
    const target = project();
    const source = hub('1.2.3');
    const result = add(target, 'api', { hub: source, migration: false });

    const payload = payloadOf(API, source);
    assert.ok(payload.has(`${CORE}/sample.ts`));
    for (const [file, content] of payload) {
      assert.equal(read(target, file), content, file);
      assert.equal(read(target, pristine(file)), content, pristine(file));
    }
    const adapters = adaptersOf(API, source);
    for (const [file, content] of adapters) assert.equal(read(target, file), content, file);

    const contract = read(source, 'packages/audit-contract/src/version.ts');
    assert.deepEqual(manifestOf(target), {
      connector: 'audit-nestjs',
      kind: 'api',
      version: '1.2.3',
      contractVersion: Number(/CONTRACT_VERSION = (\d+);/.exec(contract)?.[1]),
      files: Object.fromEntries([...payload].map(([file, content]) => [file, sha256(content)])),
      adapters: Object.fromEntries([...adapters].map(([file, content]) => [file, sha256(content)])),
    });
    assert.deepEqual(result.manifest, manifestOf(target));
    assert.deepEqual(result.kept, []);
    assert.equal(result.schemaChanged, true);
    assert.equal(result.migration, undefined);

    const schema = read(target, SCHEMA);
    assert.equal(schema.split(BEGIN).length, 2);
    assert.ok(schema.endsWith(`${END}\n`));
    assert.ok(schema.includes(`${BACK_RELATION}\n}`));
  });

  test("keeps an adapter the project has already, and records its template's hash", () => {
    const target = project();
    write(target, `${CORE}/host.ts`, '// the project wrote its own\n');
    const result = add(target, 'api', { migration: false });
    assert.deepEqual(result.kept, [`${CORE}/host.ts`]);
    assert.equal(read(target, `${CORE}/host.ts`), '// the project wrote its own\n');
    assert.equal(
      result.manifest.adapters[`${CORE}/host.ts`],
      sha256(adaptersOf(API).get(`${CORE}/host.ts`) ?? ''),
    );
    assert.match(nextSteps(result), /^Kept the project's own: apps\/api\/src\/audit\/host\.ts\.$/m);
  });

  test('refuses a project that has a connector, changing nothing', () => {
    const { target, hub: source } = installed();
    edit(target, `${CORE}/sample.ts`, 'line2 = 2', 'line2 = "here"');
    const schema = read(target, SCHEMA);
    const manifest = read(target, MANIFEST);
    assert.throws(
      () => add(target, 'api', { hub: source, migration: false }),
      /has a connector already \(audit-connector\.json\): use `pnpm connector update`/,
    );
    assert.match(read(target, `${CORE}/sample.ts`), /line2 = "here"/);
    assert.equal(read(target, SCHEMA), schema);
    assert.equal(read(target, MANIFEST), manifest);
  });

  test('leaves a schema that has the models already', () => {
    const { target, hub: source } = installed();
    const schema = read(target, SCHEMA);
    rmSync(join(target, MANIFEST));
    const result = add(target, 'api', { hub: source });
    assert.equal(result.schemaChanged, false);
    assert.equal(result.migration, undefined);
    assert.equal(read(target, SCHEMA), schema);
    assert.match(nextSteps(result), /^1\. The schema had the models already\.$/m);
  });

  test('an unknown kind is refused before anything is written', () => {
    const target = project();
    assert.throws(() => add(target, 'web'), /Unknown kind web: one of api/);
    assert.equal(existsSync(join(target, MANIFEST)), false);
    assert.equal(existsSync(join(target, CORE)), false);
    assert.equal(read(target, SCHEMA), PROJECT_SCHEMA);
  });

  test("writes the migration when the project's dependencies are installed", () => {
    const target = project();
    const source = hub();
    installPrisma(target);
    const result = add(target, 'api', { hub: source, now: NOW });
    const path = join(
      target,
      'apps/api/prisma/migrations/20261015123456_add_audit_connector/migration.sql',
    );
    assert.equal(result.migration, path);
    assert.equal(readFileSync(path, 'utf8'), expectedMigration(source));
    // Prisma compared the schema before add with the schema after it.
    assert.equal(read(target, 'apps/api/prisma-before.prisma'), PROJECT_SCHEMA);
    const args = read(target, 'apps/api/prisma-args.txt').trimEnd().split('\n');
    assert.deepEqual(
      [...args.slice(0, 3), ...args.slice(4)],
      ['migrate', 'diff', '--from-schema', '--to-schema', join(target, SCHEMA), '--script'],
    );
    assert.match(
      nextSteps(result),
      /^1\. Migration written: .*migration\.sql\. Apply it: `pnpm db:migrate`\.$/m,
    );
  });
});

describe('migration and writeMigration', () => {
  test('writes the migration later, from the schema without the connector', () => {
    const { target, hub: source } = installed();
    installPrisma(target);
    const path = migration(target, source, NOW);
    assert.equal(
      path,
      join(target, 'apps/api/prisma/migrations/20261015123456_add_audit_connector/migration.sql'),
    );
    assert.equal(readFileSync(path, 'utf8'), expectedMigration(source));
    assert.equal(read(target, 'apps/api/prisma-before.prisma').trimEnd(), PROJECT_SCHEMA.trimEnd());
  });

  test("nothing without the project's dependencies", () => {
    const { target, hub: source } = installed();
    assert.equal(writeMigration(API, target, PROJECT_SCHEMA, source, NOW), undefined);
    assert.throws(
      () => migration(target, source, NOW),
      /Install the project's dependencies first \(pnpm install\)/,
    );
    assert.equal(existsSync(join(target, 'apps/api/prisma/migrations')), false);
  });

  test('a project without the connector, or without its models, is refused', () => {
    assert.throws(() => migration(project()), /has no connector \(audit-connector\.json\)/);
    const { target, hub: source } = installed();
    installPrisma(target);
    write(target, SCHEMA, PROJECT_SCHEMA);
    assert.throws(
      () => migration(target, source, NOW),
      /No connector models in apps\/api\/prisma\/schema\.prisma/,
    );
  });
});

describe('status', () => {
  test('nothing to report right after add', () => {
    const { target, hub: source } = installed();
    assert.deepEqual(status(target, source), {
      installed: '1.0.0',
      available: '1.0.0',
      modified: [],
      missing: [],
      outdated: [],
      adapterTemplatesChanged: [],
    });
  });

  test('reports the files edited or deleted here', () => {
    const { target, hub: source } = installed();
    edit(target, `${CORE}/sample.ts`, 'line2 = 2', 'line2 = "here"');
    rmSync(join(target, CORE, 'audit.constants.ts'));
    // Adapters are the project's own code: editing one is no news.
    edit(target, `${CORE}/host.ts`, 'export', '// edited\nexport');
    const result = status(target, source);
    assert.deepEqual(result.modified, [`${CORE}/sample.ts`]);
    assert.deepEqual(result.missing, [`${CORE}/audit.constants.ts`]);
    assert.deepEqual(result.outdated, []);
    assert.deepEqual(result.adapterTemplatesChanged, []);
  });

  test('reports what a newer version changes: files, new files, adapter templates', () => {
    const { target, hub: source } = installed();
    release(source, '1.1.0');
    edit(source, `${PACKAGE}/src/audit/sample.ts`, 'line11 = 11', 'line11 = "upstream"');
    write(source, `${PACKAGE}/src/audit/added.ts`, 'export const added = true;\n');
    edit(source, `${PACKAGE}/install/api/src/audit/host.ts`, 'export', '// newer\nexport');
    assert.deepEqual(status(target, source), {
      installed: '1.0.0',
      available: '1.1.0',
      modified: [],
      missing: [],
      outdated: [`${CORE}/sample.ts`, `${CORE}/added.ts`],
      adapterTemplatesChanged: [`${CORE}/host.ts`],
    });
  });

  test('a project without the connector is refused', () => {
    assert.throws(() => status(project()), /has no connector \(audit-connector\.json\)/);
  });
});

describe('update', () => {
  test('replaces a file the project left alone, and refreshes the manifest and the pristine copies', () => {
    const { target, hub: source } = installed();
    release(source, '1.1.0');
    edit(source, `${PACKAGE}/src/audit/sample.ts`, 'line11 = 11', 'line11 = "upstream"');
    const next = read(source, `${PACKAGE}/src/audit/sample.ts`);

    const result = update(target, source);
    assert.deepEqual(result, {
      from: '1.0.0',
      to: '1.1.0',
      replaced: [`${CORE}/sample.ts`],
      merged: [],
      conflicts: [],
      added: [],
      removed: [],
      keptRemoved: [],
      adapterTemplatesChanged: [],
      schemaChanged: false,
      migration: undefined,
    });
    assert.equal(read(target, `${CORE}/sample.ts`), next);
    assert.equal(read(target, pristine(`${CORE}/sample.ts`)), next);
    const manifest = manifestOf(target);
    assert.equal(manifest.version, '1.1.0');
    assert.deepEqual(
      manifest.files,
      Object.fromEntries(
        [...payloadOf(API, source)].map(([file, content]) => [file, sha256(content)]),
      ),
    );
    const later = status(target, source);
    assert.deepEqual([later.modified, later.outdated], [[], []]);
  });

  test('merges a file edited on both sides in different places, keeping the edit made here', () => {
    const { target, hub: source } = installed();
    edit(target, `${CORE}/sample.ts`, 'line2 = 2', 'line2 = "here"');
    release(source, '1.1.0');
    edit(source, `${PACKAGE}/src/audit/sample.ts`, 'line11 = 11', 'line11 = "upstream"');

    const result = update(target, source);
    assert.deepEqual(result.merged, [`${CORE}/sample.ts`]);
    assert.deepEqual([result.replaced, result.conflicts], [[], []]);
    assert.equal(
      read(target, `${CORE}/sample.ts`),
      SAMPLE.replace('line2 = 2', 'line2 = "here"').replace('line11 = 11', 'line11 = "upstream"'),
    );
    // The new base for the next update is the version installed, without the edit.
    assert.equal(
      read(target, pristine(`${CORE}/sample.ts`)),
      read(source, `${PACKAGE}/src/audit/sample.ts`),
    );
    assert.deepEqual(status(target, source).modified, [`${CORE}/sample.ts`]);
  });

  test('leaves conflict markers where both sides changed the same lines, and reports them', () => {
    const { target, hub: source } = installed();
    edit(target, `${CORE}/sample.ts`, 'line6 = 6', 'line6 = "here"');
    release(source, '1.1.0');
    edit(source, `${PACKAGE}/src/audit/sample.ts`, 'line6 = 6', 'line6 = "upstream"');

    const result = update(target, source);
    assert.deepEqual(result.conflicts, [`${CORE}/sample.ts`]);
    assert.deepEqual(result.merged, []);
    const merged = read(target, `${CORE}/sample.ts`);
    assert.match(merged, /^<<<<<<< yours\nexport const line6 = "here";\n/m);
    assert.match(merged, /^export const line6 = "upstream";\n>>>>>>> connector 1\.1\.0$/m);
    assert.equal(manifestOf(target).version, '1.1.0');
  });

  test('merges a new upstream file into a file of the project at its path, never overwrites it', () => {
    const { target, hub: source } = installed();
    write(target, `${CORE}/added.ts`, 'export const mine = true;\n');
    release(source, '1.1.0');
    write(source, `${PACKAGE}/src/audit/added.ts`, 'export const added = true;\n');

    const result = update(target, source);
    assert.deepEqual([result.added, result.conflicts], [[], [`${CORE}/added.ts`]]);
    const merged = read(target, `${CORE}/added.ts`);
    assert.match(merged, /^<<<<<<< yours\nexport const mine = true;\n/m);
    assert.match(merged, /^export const added = true;\n>>>>>>> connector 1\.1\.0$/m);
    assert.equal(read(target, pristine(`${CORE}/added.ts`)), 'export const added = true;\n');
  });

  test('adds new files, removes those gone upstream, keeps those gone but edited here', () => {
    const target = project();
    const source = hub();
    write(source, `${PACKAGE}/src/audit/gone.ts`, 'export const gone = 1;\n');
    write(source, `${PACKAGE}/src/audit/gone-edited.ts`, 'export const goneEdited = 1;\n');
    add(target, 'api', { hub: source, migration: false });
    edit(target, `${CORE}/gone-edited.ts`, '= 1', '= 2');
    rmSync(join(target, CORE, 'audit.constants.ts'));
    release(source, '1.1.0');
    rmSync(join(source, PACKAGE, 'src/audit/gone.ts'));
    rmSync(join(source, PACKAGE, 'src/audit/gone-edited.ts'));
    write(source, `${PACKAGE}/src/audit/added.ts`, 'export const added = true;\n');

    const result = update(target, source);
    // A file deleted here comes back with the update.
    assert.deepEqual(result.added, [`${CORE}/added.ts`, `${CORE}/audit.constants.ts`]);
    assert.deepEqual(result.removed, [`${CORE}/gone.ts`]);
    assert.deepEqual(result.keptRemoved, [`${CORE}/gone-edited.ts`]);
    assert.equal(read(target, `${CORE}/added.ts`), 'export const added = true;\n');
    assert.equal(read(target, pristine(`${CORE}/added.ts`)), 'export const added = true;\n');
    assert.ok(existsSync(join(target, CORE, 'audit.constants.ts')));
    assert.equal(existsSync(join(target, CORE, 'gone.ts')), false);
    assert.equal(read(target, `${CORE}/gone-edited.ts`), 'export const goneEdited = 2;\n');
    for (const file of [`${CORE}/gone.ts`, `${CORE}/gone-edited.ts`]) {
      assert.equal(existsSync(join(target, pristine(file))), false, pristine(file));
      assert.equal(file in manifestOf(target).files, false, file);
    }
  });

  test('never touches the adapters: a changed template is reported, once', () => {
    const { target, hub: source } = installed();
    edit(target, `${CORE}/host.ts`, 'export', '// edited here\nexport');
    const local = read(target, `${CORE}/host.ts`);
    const adapters = manifestOf(target).adapters;
    release(source, '1.1.0');
    edit(source, `${PACKAGE}/install/api/src/audit/host.ts`, 'export', '// newer\nexport');

    const result = update(target, source);
    assert.deepEqual(result.adapterTemplatesChanged, [`${CORE}/host.ts`]);
    assert.equal(read(target, `${CORE}/host.ts`), local);
    // The manifest now compares the adapters to the templates this update reported.
    assert.notDeepEqual(manifestOf(target).adapters, adapters);
    assert.deepEqual(status(target, source).adapterTemplatesChanged, []);
    assert.deepEqual(update(target, source).adapterTemplatesChanged, []);
  });

  test("rewrites the connector's models where they are, and writes the migration of the change", () => {
    const { target, hub: source } = installed();
    installPrisma(target);
    const before = read(target, SCHEMA);
    release(source, '1.1.0');
    const models = `${PACKAGE}/install/api/prisma/audit-connector.prisma`;
    edit(
      source,
      models,
      '// audit-connector:end',
      'model AuditExtra {\n  id Int @id\n}\n// audit-connector:end',
    );
    write(source, `${PACKAGE}/install/api/prisma/sql/1.1.0.sql`, '-- the extra of 1.1.0\n');

    const result = update(target, source, { now: new Date(Date.UTC(2026, 9, 17, 9, 30)) });

    assert.equal(result.schemaChanged, true);
    assert.equal(
      result.migration,
      join(
        target,
        'apps/api/prisma/migrations/20261017093000_update_audit_connector/migration.sql',
      ),
    );
    // From the schema as it was, with the extras of the versions after the installed one only.
    assert.equal(read(target, 'apps/api/prisma-before.prisma'), before);
    assert.equal(
      read(
        target,
        'apps/api/prisma/migrations/20261017093000_update_audit_connector/migration.sql',
      ),
      'CREATE TABLE "audit_outbox" ();\n\n-- the extra of 1.1.0\n',
    );
    const schema = read(target, SCHEMA);
    assert.ok(schema.includes('model AuditExtra {'));
    assert.equal(schema.split(BACK_RELATION).length, 2, 'the back-relations, once');
    assert.equal(withoutConnector(schema), PROJECT_SCHEMA);
    // Up to date: a second update changes nothing more.
    assert.equal(update(target, source).schemaChanged, false);
  });

  test("refuses, changing nothing, when the models change and the project's dependencies are not installed", () => {
    const { target, hub: source } = installed();
    const before = read(target, SCHEMA);
    release(source, '1.1.0');
    edit(
      source,
      `${PACKAGE}/install/api/prisma/audit-connector.prisma`,
      '// audit-connector:end',
      'model AuditExtra {\n  id Int @id\n}\n// audit-connector:end',
    );

    assert.throws(
      () => update(target, source),
      /^Error: Version 1\.1\.0 changes the connector's tables: install the project's dependencies \(pnpm install\), then update again\. Nothing was changed\.$/,
    );
    assert.equal(read(target, SCHEMA), before);
    assert.equal(manifestOf(target).version, '1.0.0');
  });

  test('with nothing new, changes nothing', () => {
    const { target, hub: source } = installed();
    edit(target, `${CORE}/sample.ts`, 'line2 = 2', 'line2 = "here"');
    const manifest = read(target, MANIFEST);
    const result = update(target, source);
    assert.deepEqual(result, {
      from: '1.0.0',
      to: '1.0.0',
      replaced: [],
      merged: [],
      conflicts: [],
      added: [],
      removed: [],
      keptRemoved: [],
      adapterTemplatesChanged: [],
      schemaChanged: false,
      migration: undefined,
    });
    assert.match(read(target, `${CORE}/sample.ts`), /line2 = "here"/);
    assert.equal(read(target, MANIFEST), manifest);
  });

  test('a project without the connector is refused', () => {
    assert.throws(() => update(project()), /has no connector: use `pnpm connector add`/);
  });
});

describe('diff', () => {
  test('nothing for a project as installed, with nothing new', () => {
    const { target, hub: source } = installed();
    assert.equal(diff(target, source), '');
  });

  test("the project's edits, then what the available version changes", () => {
    const { target, hub: source } = installed();
    edit(target, `${CORE}/sample.ts`, 'line2 = 2', 'line2 = "here"');
    edit(source, `${PACKAGE}/src/audit/sample.ts`, 'line11 = 11', 'line11 = "upstream"');
    const text = diff(target, source);
    const local = text.indexOf('+export const line2 = "here";');
    const upstream = text.indexOf('+export const line11 = "upstream";');
    assert.ok(local !== -1 && upstream !== -1, text);
    assert.ok(local < upstream, text);
    assert.match(text, /^-export const line2 = 2;$/m);
    assert.match(text, /^-export const line11 = 11;$/m);
    // That file, each way once: nothing else differs.
    assert.equal(text.match(/^diff --git /gm)?.length, 2);
  });

  test('a project without the connector is refused', () => {
    assert.throws(() => diff(project()), /has no connector \(audit-connector\.json\)/);
  });
});

describe('nextSteps', () => {
  /** @type {import('./connector.mjs').Manifest} */
  const manifest = {
    connector: 'audit-nestjs',
    kind: 'api',
    version: '1.2.3',
    contractVersion: 1,
    files: {},
    adapters: {},
  };

  test('after add without the migration: the commands that write it later', () => {
    const text = nextSteps({ manifest, kept: [], schemaChanged: true, migration: undefined });
    const lines = text.split('\n');
    assert.equal(lines[0], 'Installed audit-nestjs 1.2.3 (contract 1).');
    assert.match(lines[1] ?? '', /^1\. The models are in apps\/api\/prisma\/schema\.prisma\./);
    assert.match(lines[1] ?? '', /`pnpm connector migration --target <this project>`/);
    assert.deepEqual(
      lines.slice(2).map((line) => line.slice(0, 2)),
      ['2.', '3.', '4.', '5.', '6.'],
    );
  });

  test('the migration written, and the adapters the project kept', () => {
    const text = nextSteps({
      manifest,
      kept: [`${CORE}/host.ts`, `${CORE}/app-catalog.ts`],
      schemaChanged: true,
      migration: '/project/apps/api/prisma/migrations/x/migration.sql',
    });
    assert.deepEqual(text.split('\n').slice(0, 3), [
      'Installed audit-nestjs 1.2.3 (contract 1).',
      "Kept the project's own: apps/api/src/audit/host.ts, apps/api/src/audit/app-catalog.ts.",
      '1. Migration written: /project/apps/api/prisma/migrations/x/migration.sql. Apply it: `pnpm db:migrate`.',
    ]);
  });
});

describe('the command line', () => {
  /**
   * Runs `pnpm connector` (against this repository's packages).
   * @param {string[]} args
   */
  function connector(args) {
    const run = spawnSync(process.execPath, [join(REPO, 'scripts/connector.mjs'), ...args], {
      encoding: 'utf8',
    });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  }

  test('without a command or a target, the usage and exit 2', () => {
    const target = project();
    for (const args of [[], ['status'], ['--target', target]]) {
      const run = connector(args);
      assert.equal(run.status, 2, args.join(' '));
      assert.match(run.stderr, /^Usage: pnpm connector <add\|status\|diff\|update\|migration>/);
    }
    const unknown = connector(['install', '--target', target]);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /Unknown command install/);
    assert.equal(existsSync(join(target, MANIFEST)), false);
  });

  test('add, then status --check: 0 while as installed, 1 once a file is edited here', () => {
    const target = project();
    const added = connector(['add', '--target', target, '--no-migration']);
    assert.equal(added.status, 0, added.stderr);
    assert.match(added.stdout, /^Installed audit-nestjs \S+ \(contract \d+\)\.$/m);
    assert.match(added.stdout, /^1\. The models are in apps\/api\/prisma\/schema\.prisma\./m);

    const clean = connector(['status', '--target', target, '--check']);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /^Installed (\S+), available \1\.\n$/);
    assert.equal(connector(['diff', '--target', target]).stdout, 'No differences.\n');

    edit(target, `${CORE}/audit.constants.ts`, 'export', '// edited here\nexport');
    const edited = connector(['status', '--target', target, '--check']);
    assert.equal(edited.status, 1);
    assert.match(edited.stdout, /^Edited here:\n {2}apps\/api\/src\/audit\/audit\.constants\.ts$/m);
    // Without --check it only reports.
    assert.equal(connector(['status', '--target', target]).status, 0);
  });

  test('status --check passes a project that is only behind the available version', () => {
    const target = project();
    add(target, 'api', { hub: hub('0.0.1'), migration: false });
    const run = connector(['status', '--target', target, '--check']);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^Installed 0\.0\.1, available /);
    assert.match(
      run.stdout,
      /^Changed in the available version:\n {2}apps\/api\/src\/audit\/sample\.ts$/m,
    );
  });

  test('update exits 1 when it leaves conflicts', () => {
    const target = project();
    const source = hub('0.0.1');
    const constants = `${PACKAGE}/src/audit/audit.constants.ts`;
    const [first = ''] = read(source, constants).split('\n');
    edit(source, constants, first, '// as Audit Hub 0.0.1 had it');
    add(target, 'api', { hub: source, migration: false });
    edit(target, `${CORE}/audit.constants.ts`, '// as Audit Hub 0.0.1 had it', '// edited here');

    const run = connector(['update', '--target', target]);
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /^Updated 0\.0\.1 → \S+\.$/m);
    assert.match(
      run.stdout,
      /^CONFLICTS \(resolve the markers\):\n {2}apps\/api\/src\/audit\/audit\.constants\.ts$/m,
    );
    assert.match(read(target, `${CORE}/audit.constants.ts`), /^<<<<<<< yours\n\/\/ edited here$/m);
  });
});

describe('compareVersions and extrasOf', () => {
  test('orders versions by their numbers', () => {
    assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
    assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
    assert.equal(compareVersions('0.2.0', '1.0.0'), -1);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
  });

  test("every version's extras for a new install, those after the installed one for an update", () => {
    const source = hub();
    write(source, `${PACKAGE}/install/api/prisma/sql/0.10.0.sql`, '-- 0.10.0\n');
    write(source, `${PACKAGE}/install/api/prisma/sql/notes.txt`, 'not an extra\n');
    const all = extrasOf(API, source);
    assert.equal(all.length, 3);
    assert.match(all[0] ?? '', /^-- audit-connector 0\.1\.0/);
    assert.match(all[1] ?? '', /^-- audit-connector 0\.2\.0/);
    assert.equal(all[2], '-- 0.10.0');
    assert.deepEqual(extrasOf(API, source, '0.2.0'), ['-- 0.10.0']);
    assert.deepEqual(extrasOf(API, source, '0.10.0'), []);
  });
});
