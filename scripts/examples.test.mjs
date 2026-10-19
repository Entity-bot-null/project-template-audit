// Tests of scripts/examples.mjs (`pnpm examples`): the template pins
// (examples/<kind>/template.json), the settings written into an example's
// .env, what of an example is the connector's (left out of its overlay),
// and `save`, whose patch must apply onto the commit the example was
// generated at. `generate` clones the template and installs its
// dependencies: it runs by hand (`pnpm examples generate --kind web`), here
// only its refusals. Every example is a throwaway git repository in the
// temporary folder. Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { adaptersOf, add, KINDS, MANIFEST, PRISTINE_DIR } from './connector.mjs';
import {
  applyTemplatePatches,
  connectorExclusions,
  connectorPaths,
  installsOf,
  EXAMPLE_ENV,
  exampleDatabaseUrl,
  exampleDir,
  generate,
  migrationDate,
  overlayPath,
  pinOf,
  save,
  setVariable,
  templatePatchDir,
  templatePatchesOf,
} from './examples.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'examples-test-'));
let counter = 0;

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const API = /** @type {import('./connector.mjs').Kind} */ (KINDS.api);
const CORE = 'apps/api/src/audit';
const SHA = '8d52b7b3648f97623c091c5607c13a2409f23bd6';
const CONNECTOR_MIGRATION = ':(exclude,glob)apps/api/prisma/migrations/*_audit_connector/**';

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  const run = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout;
}

/**
 * @param {string} dir
 * @param {string} path
 */
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');

/**
 * @param {string} dir
 * @param {string} path
 * @param {string | Uint8Array} content
 */
function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

/** A new empty folder in the temporary one. */
function folder(/** @type {string} */ name) {
  counter += 1;
  const dir = join(TMP, `${name}-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A kind whose example, template.json and overlay are all in `dir`: the kind
 * is joined into examples/<kind>/ and .examples/<kind>/, so a relative one
 * leads out of the repository. Checked first: nothing here writes inside it.
 * @param {string} dir
 */
function kindAt(dir) {
  const kind = relative(join(REPO, 'examples'), dir);
  assert.equal(exampleDir(kind), dir);
  assert.equal(overlayPath(kind), join(dir, 'overlay.patch'));
  return kind;
}

/** Makes `dir` a repository whose first commit has everything in it, as `generate` commits it. */
function commitAll(/** @type {string} */ dir) {
  git(dir, ['init', '--quiet', '--initial-branch', 'main']);
  git(dir, ['add', '--all']);
  git(dir, ['commit', '--quiet', '--no-verify', '-m', 'chore: install the Audit Hub connector']);
}

/**
 * Writes a connector manifest that installed `files`.
 * @param {string} dir
 * @param {string[]} files
 * @param {string} [kind]
 */
function writeManifest(dir, files, kind = 'api') {
  const manifest = {
    connector: 'audit-nestjs',
    kind,
    version: '1.0.0',
    contractVersion: 1,
    files: Object.fromEntries(files.map((file) => [file, 'sha-256'])),
    adapters: {},
  };
  write(dir, MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * An example as `connectorExclusions` reads it, at its base commit: a
 * manifest that installed `files`, the adapters as their templates make them
 * (or as `adapters` says), and a file of the project's own.
 * @param {string[]} files
 * @param {Record<string, string>} [adapters]
 */
function example(files, adapters = {}) {
  const dir = folder('example');
  writeManifest(dir, files);
  for (const [file, content] of adaptersOf(API)) write(dir, file, adapters[file] ?? content);
  write(dir, 'apps/api/src/app.module.ts', 'export class AppModule {}\n');
  commitAll(dir);
  return dir;
}

/** The pathspecs that leave `paths` and the connector's migration out of a diff. */
const exclusions = (/** @type {string[]} */ paths) => [
  ...paths.sort().map((path) => `:(exclude,literal)${path}`),
  CONNECTOR_MIGRATION,
];

/** Audit Hub's development database URL: apps/api/.env once set up, else its example's. */
function developmentDatabaseUrl() {
  for (const file of ['apps/api/.env', 'apps/api/.env.example']) {
    const line = existsSync(join(REPO, file))
      ? read(REPO, file)
          .split('\n')
          .find((entry) => entry.startsWith('DATABASE_URL='))
      : undefined;
    if (line !== undefined) return new URL(line.slice('DATABASE_URL='.length).trim());
  }
  return assert.fail('No DATABASE_URL in apps/api/.env or apps/api/.env.example');
}

/** A URL without its path: where the database server is, and as whom. */
const server = (/** @type {URL} */ url) => ({
  protocol: url.protocol,
  username: url.username,
  password: url.password,
  host: url.host,
  search: url.search,
});

describe('exampleDir and overlayPath', () => {
  test('the generated example under .examples/, its overlay under examples/', () => {
    assert.equal(exampleDir('web'), join(REPO, '.examples', 'web'));
    assert.equal(overlayPath('web'), join(REPO, 'examples', 'web', 'overlay.patch'));
  });
});

describe('pinOf', () => {
  test('the web example is pinned to a full commit of a template, with a connector kind', () => {
    const pin = pinOf('web');
    assert.match(pin.commit, /^[0-9a-f]{40}$/);
    assert.match(pin.repository, /^https:\/\//);
    assert.ok(pin.connector in KINDS, pin.connector);
  });

  test("the web example has the API's connector at its root and the SPA's in its web app", () => {
    assert.deepEqual(installsOf(pinOf('web')), [
      { kind: 'api', path: '' },
      { kind: 'spa', path: 'apps/web' },
    ]);
    assert.deepEqual(installsOf(pinOf('app')), [{ kind: 'expo', path: '' }]);
  });

  test('the app example is pinned to the app template, with the Expo connector', () => {
    const pin = pinOf('app');
    assert.match(pin.commit, /^[0-9a-f]{40}$/);
    assert.match(pin.repository, /project-template-app$/);
    assert.equal(pin.connector, 'expo');
  });

  test('reads examples/<kind>/template.json as written', () => {
    const dir = folder('pin');
    const pin = { repository: 'https://example.com/template.git', commit: SHA, connector: 'api' };
    write(dir, 'template.json', JSON.stringify(pin));
    assert.deepEqual(pinOf(kindAt(dir)), pin);
  });

  test('refuses a commit that is not a full SHA, or none', () => {
    const dir = folder('pin');
    const kind = kindAt(dir);
    for (const commit of [
      SHA.slice(0, 7),
      `${SHA}0`,
      `${SHA}\n`,
      ` ${SHA}`,
      'g'.repeat(40),
      'main',
      'HEAD',
      40,
      undefined,
    ]) {
      write(
        dir,
        'template.json',
        JSON.stringify({ repository: 'https://example.com/t.git', commit, connector: 'api' }),
      );
      assert.throws(
        () => pinOf(kind),
        /template\.json: commit must be a full SHA$/,
        JSON.stringify(commit),
      );
    }
  });

  test('refuses a pin without a repository, or with a connector kind that does not exist', () => {
    const dir = folder('pin');
    const kind = kindAt(dir);
    const noRepository = /template\.json: repository is required$/;
    const unknownKind = /template\.json: connector must be one of api, expo, spa$/;
    const badConnectors =
      /template\.json: connectors must be \[\{ kind, path \}\], each path inside it$/;
    const repository = 'https://example.com/t.git';
    for (const { pin, message } of [
      { pin: { commit: SHA, connector: 'api' }, message: noRepository },
      { pin: { repository: '', commit: SHA, connector: 'api' }, message: noRepository },
      { pin: { repository, commit: SHA }, message: unknownKind },
      { pin: { repository, commit: SHA, connector: 'toString' }, message: unknownKind },
      {
        pin: { repository, commit: SHA, connector: 'api', connectors: [] },
        message: badConnectors,
      },
      {
        pin: {
          repository,
          commit: SHA,
          connector: 'api',
          connectors: [{ kind: 'nope', path: '' }],
        },
        message: badConnectors,
      },
      {
        pin: {
          repository,
          commit: SHA,
          connector: 'api',
          connectors: [{ kind: 'spa', path: '../outside' }],
        },
        message: badConnectors,
      },
      {
        pin: {
          repository,
          commit: SHA,
          connector: 'api',
          connectors: [{ kind: 'spa', path: '/abs' }],
        },
        message: badConnectors,
      },
    ]) {
      write(dir, 'template.json', JSON.stringify(pin));
      assert.throws(() => pinOf(kind), message, JSON.stringify(pin));
    }
  });

  test('a kind without a template.json is no example', () => {
    assert.throws(
      () => pinOf('no-such-kind'),
      /^Error: No example no-such-kind \(examples\/no-such-kind\/template\.json\)$/,
    );
  });
});

describe('exampleDatabaseUrl', () => {
  test("Audit Hub's development database server, with the example's database name", () => {
    const url = new URL(exampleDatabaseUrl('example_web'));
    assert.equal(url.pathname, '/example_web');
    assert.deepEqual(server(url), server(developmentDatabaseUrl()));
    assert.deepEqual(server(new URL(exampleDatabaseUrl('other'))), server(url));
  });
});

describe('EXAMPLE_ENV', () => {
  test("the web example's database and ports are apart from Audit Hub's development ones", () => {
    const text = read(REPO, 'apps/api/.env.example');
    const values = parseEnv(text);
    const value = (/** @type {string} */ name) => values[name] ?? assert.fail(`No ${name}`);
    const settings = EXAMPLE_ENV.web;
    assert.notEqual(settings.database, new URL(value('DATABASE_URL')).pathname.slice(1));
    assert.notEqual(settings.apiPort, value('PORT'));
    assert.notEqual(settings.webPort, new URL(value('APP_ORIGIN')).port);
    assert.notEqual(settings.apiPort, settings.webPort);
  });
});

describe('setVariable', () => {
  test('replaces the line that sets it', () => {
    assert.equal(
      setVariable('NODE_ENV=development\nPORT=3200\nTZ=UTC\n', 'PORT', '3400'),
      'NODE_ENV=development\nPORT=3400\nTZ=UTC\n',
    );
    assert.equal(
      setVariable('MAIL_SMTP_URL=smtp://localhost:1045\n', 'MAIL_SMTP_URL', ''),
      'MAIL_SMTP_URL=\n',
    );
  });

  test('replaces a commented-out line, so the variable is set', () => {
    assert.equal(setVariable('# Port\n# PORT=3000\n', 'PORT', '3400'), '# Port\nPORT=3400\n');
    assert.equal(setVariable('#PORT=3000\n', 'PORT', '3400'), 'PORT=3400\n');
    assert.equal(setVariable('#\tPORT=3000\n', 'PORT', '3400'), 'PORT=3400\n');
  });

  test('sets the live line, not a commented-out one above it (the last line wins)', () => {
    assert.equal(
      setVariable('# PORT=3000\nPORT=3200\n', 'PORT', '3400'),
      '# PORT=3000\nPORT=3400\n',
    );
  });

  test('appends it when no line sets it', () => {
    assert.equal(
      setVariable('NODE_ENV=development\n\n', 'PORT', '3400'),
      'NODE_ENV=development\nPORT=3400\n',
    );
    assert.equal(
      setVariable('NODE_ENV=development', 'PORT', '3400'),
      'NODE_ENV=development\nPORT=3400\n',
    );
  });

  test('leaves alone the variables whose names only start or end like it', () => {
    const text = 'API_PORT=1\nPORT_RANGE=2\n# APP_PORT=3\nDATABASE_URL_TEST=4\n';
    assert.equal(setVariable(text, 'PORT', '3400'), `${text}PORT=3400\n`);
    assert.equal(setVariable(text, 'DATABASE_URL', 'x'), `${text}DATABASE_URL=x\n`);
  });

  test('keeps the lines above it, blank or a lone #', () => {
    assert.equal(setVariable('TZ=UTC\n\nPORT=3200\n', 'PORT', '3400'), 'TZ=UTC\n\nPORT=3400\n');
    assert.equal(setVariable('TZ=UTC\n#\nPORT=3200\n', 'PORT', '3400'), 'TZ=UTC\n#\nPORT=3400\n');
  });

  test('keeps the line ends of a file written on Windows', () => {
    assert.equal(setVariable('TZ=UTC\r\nPORT=3200\r\n', 'PORT', '3400'), 'TZ=UTC\r\nPORT=3400\r\n');
  });

  test('writes the value as given, $ signs included', () => {
    // Each of $$, $&, $' and $` means something to String.prototype.replace.
    const value = "costs $$5, keeps $& and $' and $`, ends";
    assert.equal(setVariable('NOTE=before\n', 'NOTE', value), `NOTE=${value}\n`);
  });
});

describe('migrationDate', () => {
  test("a second after the template's newest migration, whatever the connector's own", () => {
    const dir = folder('migrations');
    for (const name of [
      '20260101000000_init',
      '20261013030759_add_invitations',
      '20991231235959_add_audit_connector',
      '20991231235960_update_audit_connector',
      'migration_lock.toml',
    ]) {
      mkdirSync(join(dir, name));
    }
    assert.equal(migrationDate(dir).toISOString(), '2026-10-13T03:08:00.000Z');
  });

  test('refuses a template without migrations', () => {
    const dir = folder('migrations');
    mkdirSync(join(dir, 'migration_lock.toml'));
    assert.throws(() => migrationDate(dir), /^Error: No migration of the template in /);
  });
});

describe('connectorExclusions', () => {
  const adapters = [...adaptersOf(API).keys()];

  test('the manifest, the pristine copies, the files installed now and at the base, the adapters as made, the migration', () => {
    const dir = example([`${CORE}/kept.ts`, `${CORE}/gone.ts`]);
    // Updated since: the connector ships new.ts, and gone.ts no more.
    writeManifest(dir, [`${CORE}/kept.ts`, `${CORE}/new.ts`]);
    assert.deepEqual(
      connectorExclusions(dir),
      exclusions([
        MANIFEST,
        PRISTINE_DIR,
        `${CORE}/kept.ts`,
        `${CORE}/new.ts`,
        `${CORE}/gone.ts`,
        ...adapters,
      ]),
    );
  });

  test("an adapter edited from its template is the example's own; one deleted is not", () => {
    const dir = example([`${CORE}/kept.ts`]);
    write(dir, `${CORE}/host.ts`, `${read(dir, `${CORE}/host.ts`)}// the example's edit\n`);
    rmSync(join(dir, CORE, 'audit.wiring.ts'));
    assert.deepEqual(
      connectorExclusions(dir),
      exclusions([
        MANIFEST,
        PRISTINE_DIR,
        `${CORE}/kept.ts`,
        ...adapters.filter((file) => file !== `${CORE}/host.ts`),
      ]),
    );
  });

  test('an adapter edited from an older template is refused: its patch would not apply to a fresh one', () => {
    const dir = example([], { [`${CORE}/host.ts`]: '// an older template\n' });
    write(dir, `${CORE}/host.ts`, "// an older template\n// the example's edit\n");
    assert.throws(
      () => connectorExclusions(dir),
      /^Error: apps\/api\/src\/audit\/host\.ts: edited from an older template of the adapter\. .*\(pnpm examples generate --force\)/,
    );
  });

  test("an adapter left as an older template made it is not the example's either", () => {
    const dir = example([], { [`${CORE}/host.ts`]: '// an older template\n' });
    assert.deepEqual(connectorExclusions(dir), exclusions([MANIFEST, PRISTINE_DIR, ...adapters]));
  });

  test('a folder without the connector, or with an unknown kind, is refused', () => {
    assert.throws(() => connectorExclusions(folder('empty')), /has no audit-connector\.json$/);
    const dir = folder('unknown');
    writeManifest(dir, [], 'web');
    assert.throws(
      () => connectorExclusions(dir),
      /^Error: Unknown kind web in audit-connector\.json$/,
    );
  });
});

describe('save', () => {
  test("writes the example's own changes as a patch that applies onto its base commit", () => {
    const dir = folder('generated');
    const kind = kindAt(dir);
    write(dir, 'apps/api/prisma/schema.prisma', 'model User {\n  id String @id\n}\n');
    write(dir, 'apps/api/src/app.module.ts', 'export class AppModule {}\n');
    write(dir, 'README.md', '# The template\n');
    add(dir, 'api', { migration: false });
    commitAll(dir);
    const base = git(dir, ['rev-parse', 'HEAD']).trim();
    const installed = {
      core: read(dir, `${CORE}/audit.module.ts`),
      manifest: read(dir, MANIFEST),
      pristine: read(dir, `${PRISTINE_DIR}/pristine/${CORE}/audit.module.ts.orig`),
    };

    // The example's own changes: edited, new (binary too), deleted, an adapter edited.
    write(dir, 'apps/api/src/app.module.ts', 'export class AppModule {} // with AuditModule\n');
    write(dir, 'apps/api/src/notes/notes.ts', 'export const notes = [];\n');
    write(
      dir,
      'apps/web/public/icon.bin',
      Uint8Array.from({ length: 256 }, (_, byte) => byte),
    );
    rmSync(join(dir, 'README.md'));
    write(dir, `${CORE}/host.ts`, `${read(dir, `${CORE}/host.ts`)}// the example's edit\n`);
    write(dir, 'apps/api/prisma/migrations/20261016000000_add_notes/migration.sql', 'SELECT 1;\n');
    // The connector's: a generated example gets them afresh, never from the overlay.
    write(dir, `${CORE}/audit.module.ts`, `${installed.core}// edited in the example\n`);
    write(dir, MANIFEST, installed.manifest.replace('"version": "', '"version": "9.9.9-'));
    write(dir, `${PRISTINE_DIR}/pristine/${CORE}/audit.module.ts.orig`, '// changed\n');
    write(
      dir,
      'apps/api/prisma/migrations/20261015123456_add_audit_connector/migration.sql',
      'CREATE TABLE "audit_outbox" ();\n',
    );

    // The connectors are where the base commit has a manifest: its root here.
    assert.deepEqual(connectorPaths(dir), ['']);
    const result = save(kind);
    assert.equal(result.path, join(dir, 'overlay.patch'));
    const patch = readFileSync(result.path, 'utf8');
    assert.equal(result.bytes, patch.length);
    assert.deepEqual(
      [...patch.matchAll(/^diff --git a\/(\S+) b\//gm)].map((match) => match[1]),
      [
        'README.md',
        'apps/api/prisma/migrations/20261016000000_add_notes/migration.sql',
        'apps/api/src/app.module.ts',
        'apps/api/src/audit/host.ts',
        'apps/api/src/notes/notes.ts',
        'apps/web/public/icon.bin',
      ],
    );
    assert.match(patch, /^GIT binary patch$/m);

    const fresh = folder('fresh');
    git(TMP, ['clone', '--quiet', dir, fresh]);
    assert.equal(git(fresh, ['rev-parse', 'HEAD']).trim(), base);
    git(fresh, ['apply', '--check', result.path]);
    git(fresh, ['apply', result.path]);
    for (const file of [
      'apps/api/prisma/migrations/20261016000000_add_notes/migration.sql',
      'apps/api/src/app.module.ts',
      `${CORE}/host.ts`,
      'apps/api/src/notes/notes.ts',
      'apps/web/public/icon.bin',
    ]) {
      assert.deepEqual(readFileSync(join(fresh, file)), readFileSync(join(dir, file)), file);
    }
    assert.equal(existsSync(join(fresh, 'README.md')), false);
    assert.equal(read(fresh, `${CORE}/audit.module.ts`), installed.core);
    assert.equal(read(fresh, MANIFEST), installed.manifest);
    assert.equal(
      read(fresh, `${PRISTINE_DIR}/pristine/${CORE}/audit.module.ts.orig`),
      installed.pristine,
    );
    assert.equal(
      existsSync(join(fresh, 'apps/api/prisma/migrations/20261015123456_add_audit_connector')),
      false,
    );
  });

  test('a kind without a generated example is refused, writing nothing', () => {
    assert.throws(
      () => save('no-such-kind'),
      /No generated example in .*no-such-kind: pnpm examples generate --kind no-such-kind$/,
    );
    const dir = folder('not-generated');
    assert.throws(() => save(kindAt(dir)), /No generated example in /);
    assert.equal(existsSync(join(dir, 'overlay.patch')), false);
  });
});

describe('template patches', () => {
  test('the series under examples/<kind>/template-patch/, in its order; none without the folder', () => {
    const dir = folder('series');
    const kind = kindAt(dir);
    assert.equal(templatePatchDir(kind), join(dir, 'template-patch'));
    assert.deepEqual(templatePatchesOf(kind), []);
    write(dir, 'template-patch/0002-feat-two.patch', '');
    write(dir, 'template-patch/0001-fix-one.patch', '');
    write(dir, 'template-patch/README.md', '# Not a patch\n');
    assert.deepEqual(templatePatchesOf(kind), [
      join(dir, 'template-patch/0001-fix-one.patch'),
      join(dir, 'template-patch/0002-feat-two.patch'),
    ]);
  });

  test('save writes the commits between the pin and the base; they apply on the pin to the same tree', () => {
    const dir = folder('patched');
    const kind = kindAt(dir);
    // The template at its pin.
    write(dir, 'apps/api/prisma/schema.prisma', 'model User {\n  id String @id\n}\n');
    write(dir, 'apps/api/src/app.module.ts', 'export class AppModule {}\n');
    write(dir, 'README.md', '# The template\n');
    commitAll(dir);
    const pin = git(dir, ['rev-parse', 'HEAD']).trim();
    // Two template patches, then the base commit with the connector.
    write(dir, 'README.md', '# The template, patched\n');
    git(dir, ['commit', '--quiet', '--no-verify', '-am', 'fix: one']);
    write(dir, 'apps/api/src/users/roles.ts', 'export const roles = [];\n');
    git(dir, ['add', '--all']);
    git(dir, ['commit', '--quiet', '--no-verify', '-m', 'feat: two\n\nWith a body.']);
    add(dir, 'api', { migration: false });
    git(dir, ['add', '--all']);
    git(dir, ['commit', '--quiet', '--no-verify', '-m', 'chore: install the Audit Hub connector']);
    write(dir, 'template.json', JSON.stringify({ repository: dir, commit: pin, connector: 'api' }));

    const result = save(kind);
    assert.equal(result.patches, 2);
    const patches = templatePatchesOf(kind);
    assert.deepEqual(
      patches.map((path) => relative(templatePatchDir(kind), path)),
      ['0001-fix-one.patch', '0002-feat-two.patch'],
    );
    const first = readFileSync(patches[0] ?? '', 'utf8');
    // No commit id and no git version: the same series gives the same files.
    assert.match(first, /^From 0{40} /);
    assert.doesNotMatch(first, /^-- $/m);
    const saved = patches.map((path) => readFileSync(path));
    save(kind);
    assert.deepEqual(
      templatePatchesOf(kind).map((path) => readFileSync(path)),
      saved,
    );

    const fresh = folder('applied');
    git(TMP, ['clone', '--quiet', dir, fresh]);
    git(fresh, ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', pin]);
    applyTemplatePatches(fresh, patches);
    assert.deepEqual(
      git(fresh, ['log', '--format=%s', `${pin}..HEAD`])
        .trim()
        .split('\n'),
      ['feat: two', 'fix: one'],
    );
    assert.equal(
      git(fresh, ['rev-parse', 'HEAD^{tree}']).trim(),
      git(dir, ['rev-parse', 'HEAD^^{tree}']).trim(),
    );
  });

  test('save leaves no stale patch when the series shrinks, and none for an example without one', () => {
    const dir = folder('unpatched');
    const kind = kindAt(dir);
    write(dir, 'apps/api/prisma/schema.prisma', 'model User {\n  id String @id\n}\n');
    write(dir, 'apps/api/src/app.module.ts', 'export class AppModule {}\n');
    commitAll(dir);
    const pin = git(dir, ['rev-parse', 'HEAD']).trim();
    add(dir, 'api', { migration: false });
    git(dir, ['add', '--all']);
    git(dir, ['commit', '--quiet', '--no-verify', '-m', 'chore: install the Audit Hub connector']);
    write(dir, 'template.json', JSON.stringify({ repository: dir, commit: pin, connector: 'api' }));
    write(dir, 'template-patch/0001-gone.patch', 'From 0\n');
    assert.equal(save(kind).patches, 0);
    assert.deepEqual(templatePatchesOf(kind), []);
  });

  test('save writes no overlay when the example adds nothing of its own, and removes a stale one', () => {
    const dir = folder('nothing-on-top');
    const kind = kindAt(dir);
    write(dir, 'apps/api/prisma/schema.prisma', 'model User {\n  id String @id\n}\n');
    write(dir, 'apps/api/src/app.module.ts', 'export class AppModule {}\n');
    add(dir, 'api', { migration: false });
    write(dir, 'overlay.patch', 'diff --git a/stale b/stale\n');
    commitAll(dir);
    git(dir, ['rm', '--quiet', '--cached', 'overlay.patch']);
    const result = save(kind);
    assert.equal(result.bytes, 0);
    assert.equal(existsSync(join(dir, 'overlay.patch')), false);
  });
});

describe('generate', () => {
  test('refuses a kind without a pin, and an example that exists without --force', () => {
    assert.throws(() => generate('no-such-kind'), /No example no-such-kind/);
    const dir = folder('existing');
    write(
      dir,
      'template.json',
      JSON.stringify({ repository: 'https://example.com/t.git', commit: SHA, connector: 'api' }),
    );
    assert.throws(() => generate(kindAt(dir)), /exists: --force replaces it$/);
    assert.equal(existsSync(join(dir, 'template.json')), true);
  });
});

describe('the command line', () => {
  test('without a known command, the usage and exit 2', () => {
    for (const args of [[], ['clean']]) {
      const run = spawnSync(process.execPath, [join(REPO, 'scripts/examples.mjs'), ...args], {
        encoding: 'utf8',
      });
      assert.equal(run.status, 2, args.join(' '));
      assert.match(
        run.stderr,
        /^Usage: pnpm examples <generate\|save> --kind web\|app \[--force\]$/m,
      );
    }
  });
});
