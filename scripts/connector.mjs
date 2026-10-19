// `pnpm connector`: installs an Audit Hub connector into a project created
// from the templates, as source (docs/adr/0009), and keeps it up to date.
//
//   pnpm connector add    --target <project> [--kind api|expo|spa]
//   pnpm connector status --target <project> [--check]
//   pnpm connector diff   --target <project>
//   pnpm connector update --target <project>
//   pnpm connector migration --target <project>
//
// `add` copies the connector and the contract it is built on, creates the
// project's adapters once (for the API host.ts, audit.wiring.ts,
// app-catalog.ts; for the app src/api/audit.ts, src/lib/storage/auditQueue.ts,
// audit.wiring.ts: then the project's own code), adds the API connector's
// models to the Prisma schema and, when the project's dependencies are
// installed, writes their migration. It records what it installed in audit-connector.json (the
// version, each file's SHA-256) and a pristine copy of each file under
// .audit-connector/, which `update` merges against: a file the project left
// alone is replaced, a file it edited gets a three-way merge (git
// merge-file), with conflict markers where both sides changed. Adapters are
// never touched after `add`; `status` says when their template changed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MANIFEST = 'audit-connector.json';
/**
 * The contract's generator of the published JSON Schema and its drift check
 * against packages/audit-contract/schema/: Audit Hub's, nothing a project runs.
 */
export const HUB_ONLY_CONTRACT_FILES = ['json-schemas.ts', 'json-schemas.spec.ts'];
export const PRISTINE_DIR = '.audit-connector';

/**
 * The part of the contract the Expo connector uses, with the specs that
 * cover it: the app's coverage counts every file under src/, so it gets no
 * module it does not import. Each imports only the others (connector.test.mjs).
 */
export const EXPO_CONTRACT_FILES = [
  'account-api.spec.ts',
  'account-api.ts',
  'canonical-json.spec.ts',
  'canonical-json.ts',
  'connector-api.ts',
  'event.spec.ts',
  'event.ts',
  'patterns.ts',
  'testing/events.ts',
  'unicode.spec.ts',
  'unicode.ts',
  'uuidv7.spec.ts',
  'uuidv7.ts',
  'version.ts',
];

/** The SPA connector's part: the event's types and UUIDv7, with their specs. */
export const SPA_CONTRACT_FILES = EXPO_CONTRACT_FILES.filter(
  (file) => !file.startsWith('account-api') && !file.startsWith('connector-api'),
);

/**
 * @typedef {object} Kind
 * @property {string} connector  The package's name.
 * @property {string} packageDir The package, from Audit Hub's root.
 * @property {string} source     Its installed sources, from the package.
 * @property {string} target     Where they go, from the project's root.
 * @property {string[]} doubles  The package's test doubles of the adapters: not installed.
 * @property {string} adapters   The adapters' templates, from the package: their src/ maps onto…
 * @property {string} adaptersRoot …this directory of the project ('' for its root).
 * @property {string} contractTarget Where the contract goes, from the project's root.
 * @property {string[]} [contractFiles] The contract files it gets; all but the hub's own when absent.
 * @property {boolean} [extensionless] A bundler-resolved app (Expo, the SPA): imports without
 *   their .js extension, and an index of the contract files it got.
 * @property {boolean} [jestSpecs] Specs run under Jest (Expo): without their vitest import.
 * @property {string} [schema]   The project's Prisma schema, from its root.
 */

/** @type {Record<string, Kind>} */
export const KINDS = {
  api: {
    connector: 'audit-nestjs',
    packageDir: 'packages/audit-nestjs',
    source: 'src/audit',
    target: 'apps/api/src/audit',
    doubles: ['host.ts', 'audit.wiring.ts', 'app-catalog.ts'],
    adapters: 'install/api',
    adaptersRoot: 'apps/api',
    contractTarget: 'apps/api/src/audit/contract',
    schema: 'apps/api/prisma/schema.prisma',
  },
  expo: {
    connector: 'audit-expo',
    packageDir: 'packages/audit-expo',
    source: 'src/audit',
    target: 'src/lib/audit',
    doubles: [],
    adapters: 'install/app',
    adaptersRoot: '',
    contractTarget: 'src/lib/audit/contract',
    contractFiles: EXPO_CONTRACT_FILES,
    extensionless: true,
    jestSpecs: true,
  },
  // Installed into the web app's own directory (--target <project>/apps/web),
  // with a manifest of its own: a project has its API's connector at its root.
  spa: {
    connector: 'audit-web',
    packageDir: 'packages/audit-web',
    source: 'src/audit',
    target: 'src/audit',
    doubles: [],
    adapters: 'install/web',
    adaptersRoot: '',
    contractTarget: 'src/audit/contract',
    contractFiles: SPA_CONTRACT_FILES,
    extensionless: true,
  },
};

/**
 * @typedef {object} Manifest
 * @property {string} connector
 * @property {string} kind
 * @property {string} version
 * @property {number} contractVersion
 * @property {Record<string, string>} files     Installed file → SHA-256 as installed.
 * @property {Record<string, string>} adapters  Adapter → SHA-256 of its template when created.
 */

const sha256 = (/** @type {string | Buffer} */ content) =>
  createHash('sha256').update(content).digest('hex');

/** Every file under `dir`, relative to it, with "/" separators, sorted. */
export function walk(/** @type {string} */ dir) {
  /** @type {string[]} */
  const files = [];
  const visit = (/** @type {string} */ current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(relative(dir, path).split(sep).join('/'));
    }
  };
  visit(dir);
  return files.sort();
}

/** The package's version, and the contract's. */
function versions(/** @type {Kind} */ kind, /** @type {string} */ hub) {
  const pkg = JSON.parse(readFileSync(join(hub, kind.packageDir, 'package.json'), 'utf8'));
  const contract = readFileSync(join(hub, 'packages/audit-contract/src/version.ts'), 'utf8');
  const match = /export const CONTRACT_VERSION = (\d+);/.exec(contract);
  if (match === null)
    throw new Error('No CONTRACT_VERSION in packages/audit-contract/src/version.ts');
  return { version: String(pkg.version), contractVersion: Number(match[1]) };
}

/**
 * A contract file as an app built by a bundler (Metro, Vite) reads it:
 * relative imports without their .js extension; for Jest (`jest`), a spec
 * without its vitest import (Jest's globals are the same three).
 */
export function forBundler(
  /** @type {string} */ file,
  /** @type {string} */ content,
  /** @type {{ jest?: boolean }} */ options = { jest: true },
) {
  const text = content.replace(/(from '\.{1,2}\/[^']*?)\.js'/g, "$1'");
  return options.jest === true && file.endsWith('.spec.ts')
    ? text.replace(/^import \{[^}]*\} from 'vitest';\n/m, '')
    : text;
}

/** The index of a bundler kind's contract: the modules it got, one per file. */
function bundlerIndex(/** @type {readonly string[]} */ files) {
  const modules = files
    .filter((file) => !file.endsWith('.spec.ts') && !file.startsWith('testing/'))
    .map((file) => `export * from './${file.replace(/\.ts$/, '')}';`);
  return [
    '// The part of the integration contract (packages/audit-contract) the connector',
    '// uses, copied by `pnpm connector add`: one module per file, as in the package.',
    ...modules,
    '',
  ].join('\n');
}

/**
 * What a version installs: project path → content. The connector's sources
 * (without its test doubles and its contract shim), and the contract's
 * sources. For the API, the whole contract, whose index also exports the
 * Node.js part: the connector imports both through `./contract/index.js`.
 * For the app, its part of the contract, imported through `./contract`.
 */
export function payloadOf(/** @type {Kind} */ kind, /** @type {string} */ hub = ROOT) {
  /** @type {Map<string, string>} */
  const files = new Map();
  const source = join(hub, kind.packageDir, kind.source);
  for (const file of walk(source)) {
    if (kind.doubles.includes(file) || file.startsWith('contract/')) continue;
    files.set(`${kind.target}/${file}`, readFileSync(join(source, file), 'utf8'));
  }
  const contract = join(hub, 'packages/audit-contract/src');
  const contractFiles =
    kind.contractFiles ?? walk(contract).filter((file) => !HUB_ONLY_CONTRACT_FILES.includes(file));
  for (const file of contractFiles) {
    let content = readFileSync(join(contract, file), 'utf8');
    if (kind.extensionless === true) {
      content = forBundler(file, content, { jest: kind.jestSpecs === true });
    } else if (file === 'index.ts') {
      content = `${content.trimEnd()}\n// Added by pnpm connector: the connector imports the Node.js part from here too.\nexport * from './node/index.js';\n`;
    }
    files.set(`${kind.contractTarget}/${file}`, content);
  }
  if (kind.extensionless === true) {
    files.set(`${kind.contractTarget}/index.ts`, bundlerIndex(contractFiles));
  }
  return files;
}

/** The adapters' templates: project path → content. */
export function adaptersOf(/** @type {Kind} */ kind, /** @type {string} */ hub = ROOT) {
  /** @type {Map<string, string>} */
  const files = new Map();
  const dir = join(hub, kind.packageDir, kind.adapters, 'src');
  for (const file of walk(dir)) {
    const path = [kind.adaptersRoot, 'src', file].filter((part) => part !== '').join('/');
    files.set(path, readFileSync(join(dir, file), 'utf8'));
  }
  return files;
}

const pristinePath = (/** @type {string} */ target, /** @type {string} */ file) =>
  join(target, PRISTINE_DIR, 'pristine', `${file}.orig`);

function write(/** @type {string} */ path, /** @type {string} */ content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function readManifest(/** @type {string} */ target) {
  const path = join(target, MANIFEST);
  if (!existsSync(path)) return undefined;
  return /** @type {Manifest} */ (JSON.parse(readFileSync(path, 'utf8')));
}

function writeManifest(/** @type {string} */ target, /** @type {Manifest} */ manifest) {
  writeFileSync(join(target, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}

const BEGIN = '// audit-connector:begin';
const END = '// audit-connector:end';

/**
 * Adds the connector's models to the project's Prisma schema, once (between
 * markers). Answers the schema as it was, or undefined when they were there.
 */
export function addModels(
  /** @type {Kind} */ kind,
  /** @type {string} */ target,
  /** @type {string} */ hub = ROOT,
) {
  if (kind.schema === undefined) return undefined;
  const schemaPath = join(target, kind.schema);
  const schema = readFileSync(schemaPath, 'utf8');
  if (schema.includes(BEGIN)) return undefined;
  const models = readFileSync(
    join(hub, kind.packageDir, kind.adapters, 'prisma/audit-connector.prisma'),
    'utf8',
  );
  writeFileSync(schemaPath, `${withBackRelations(schema).trimEnd()}\n\n${models.trimEnd()}\n`);
  return schema;
}

/** The fields Prisma needs on the template's User for the connector's relations. */
const BACK_RELATIONS = [
  'auditSecurityPrompts AuditSecurityPrompt[]',
  'auditPushTokens AuditPushToken[]',
];
const LINE_MARK = '// audit-connector';

/** The schema with the back-relation fields added to model User, each line marked. */
export function withBackRelations(/** @type {string} */ schema) {
  const match = /^model User \{\n([\s\S]*?)^\}/m.exec(schema);
  if (match === null) throw new Error('No model User in the Prisma schema');
  const fields = BACK_RELATIONS.map((field) => `  ${field} ${LINE_MARK}`).join('\n');
  const end = match.index + match[0].length - 1;
  return `${schema.slice(0, end)}${fields}\n${schema.slice(end)}`;
}

/** The schema without the connector: its models and its marked lines. */
export function withoutConnector(/** @type {string} */ schema) {
  const begin = schema.indexOf(BEGIN);
  const end = schema.indexOf(END);
  const models =
    begin === -1 || end === -1
      ? schema
      : `${schema.slice(0, begin).trimEnd()}\n${schema.slice(end + END.length).replace(/^\n/, '')}`;
  return models
    .split('\n')
    .filter((line) => !line.trimEnd().endsWith(LINE_MARK))
    .join('\n');
}

/**
 * The schema with this version's models: the block between the markers
 * replaced where it is, and the marked lines of model User written again.
 * Undefined when the schema has them already, as they are.
 */
export function withModelsOf(
  /** @type {Kind} */ kind,
  /** @type {string} */ schema,
  /** @type {string} */ hub = ROOT,
) {
  const begin = schema.indexOf(BEGIN);
  const end = schema.indexOf(END);
  if (begin === -1 || end === -1)
    throw new Error(`No connector models in ${kind.schema ?? 'the schema'}`);
  const models = readFileSync(
    join(hub, kind.packageDir, kind.adapters, 'prisma/audit-connector.prisma'),
    'utf8',
  ).trimEnd();
  const replaced = `${schema.slice(0, begin)}${models}${schema.slice(end + END.length)}`;
  const next = withBackRelations(
    replaced
      .split('\n')
      .filter((line) => !line.trimEnd().endsWith(LINE_MARK))
      .join('\n'),
  );
  return next === schema ? undefined : next;
}

/** The project's Prisma CLI, there once its dependencies are installed. */
function prismaOf(/** @type {Kind} */ kind, /** @type {string} */ target) {
  if (kind.schema === undefined) return undefined;
  const path = join(target, dirname(dirname(kind.schema)), 'node_modules/.bin/prisma');
  return existsSync(path) ? path : undefined;
}

/** A version's numbers, to compare: 0.10.0 after 0.9.0. */
const versionParts = (/** @type {string} */ version) => version.split('.').map(Number);

/** -1, 0 or 1, as `a` comes before, with, or after `b`. */
export function compareVersions(/** @type {string} */ a, /** @type {string} */ b) {
  const [left, right] = [versionParts(a), versionParts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/**
 * What Prisma's schema does not express (CHECK constraints, partial indexes),
 * one file per version that changed the tables (prisma/sql/<version>.sql), in
 * version order: every one for a new install, those after `from` for an update.
 */
export function extrasOf(
  /** @type {Kind} */ kind,
  /** @type {string} */ hub = ROOT,
  /** @type {string | undefined} */ from = undefined,
) {
  const dir = join(hub, kind.packageDir, kind.adapters, 'prisma/sql');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => /^(\d+\.\d+\.\d+)\.sql$/.exec(name)?.[1])
    .filter((version) => version !== undefined)
    .filter((version) => from === undefined || compareVersions(version, from) > 0)
    .sort(compareVersions)
    .map((version) => readFileSync(join(dir, `${version}.sql`), 'utf8').trimEnd());
}

/**
 * The migration of the connector's tables: Prisma's SQL from the schema
 * `before` to the project's schema now (schema to schema, no database
 * needed), and the extras Prisma does not express. A new install
 * (`from` undefined) adds them all; an update from `from` adds what changed
 * since. Needs the project's dependencies; answers the migration's path, or
 * undefined when they are not installed.
 */
export function writeMigration(
  /** @type {Kind} */ kind,
  /** @type {string} */ target,
  /** @type {string} */ before,
  /** @type {string} */ hub = ROOT,
  /** @type {Date} */ now = new Date(),
  /** @type {string | undefined} */ from = undefined,
) {
  const prisma = prismaOf(kind, target);
  if (kind.schema === undefined || prisma === undefined) return undefined;
  const api = join(target, dirname(dirname(kind.schema)));
  const scratch = mkdtempSync(join(tmpdir(), 'audit-connector-'));
  try {
    const old = join(scratch, 'schema.prisma');
    writeFileSync(old, before);
    const sql = execFileSync(
      prisma,
      [
        'migrate',
        'diff',
        '--from-schema',
        old,
        '--to-schema',
        join(target, kind.schema),
        '--script',
      ],
      { cwd: api, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
    const name = from === undefined ? 'add_audit_connector' : 'update_audit_connector';
    const path = join(api, 'prisma/migrations', `${stamp}_${name}`, 'migration.sql');
    write(path, `${[sql.trimEnd(), ...extrasOf(kind, hub, from)].join('\n\n')}\n`);
    return path;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The migration of the connector's tables, for a project whose dependencies
 * were not installed at `add`: the schema before is the schema without the
 * connector's models.
 */
export function migration(
  /** @type {string} */ target,
  /** @type {string} */ hub = ROOT,
  /** @type {Date} */ now = new Date(),
) {
  const manifest = readManifest(target);
  if (manifest === undefined) throw new Error(`${target} has no connector (${MANIFEST})`);
  const kind = KINDS[manifest.kind];
  if (kind?.schema === undefined) throw new Error(`The ${manifest.kind} connector has no tables`);
  const schema = readFileSync(join(target, kind.schema), 'utf8');
  if (!schema.includes(BEGIN)) throw new Error(`No connector models in ${kind.schema}`);
  const before = withoutConnector(schema);
  const path = writeMigration(kind, target, before, hub, now);
  if (path === undefined)
    throw new Error("Install the project's dependencies first (pnpm install)");
  return path;
}

/** Installs the connector; refuses a project that has one. */
export function add(
  /** @type {string} */ target,
  /** @type {string} */ kindName = 'api',
  /** @type {{ hub?: string; migration?: boolean; now?: Date }} */ options = {},
) {
  const hub = options.hub ?? ROOT;
  const kind = KINDS[kindName];
  if (kind === undefined)
    throw new Error(`Unknown kind ${kindName}: one of ${Object.keys(KINDS).join(', ')}`);
  if (readManifest(target) !== undefined) {
    throw new Error(
      `${target} has a connector already (${MANIFEST}): use \`pnpm connector update\``,
    );
  }
  const { version, contractVersion } = versions(kind, hub);
  /** @type {Manifest} */
  const manifest = {
    connector: kind.connector,
    kind: kindName,
    version,
    contractVersion,
    files: {},
    adapters: {},
  };
  for (const [file, content] of payloadOf(kind, hub)) {
    write(join(target, file), content);
    write(pristinePath(target, file), content);
    manifest.files[file] = sha256(content);
  }
  /** @type {string[]} */
  const kept = [];
  for (const [file, content] of adaptersOf(kind, hub)) {
    manifest.adapters[file] = sha256(content);
    if (existsSync(join(target, file))) kept.push(file);
    else write(join(target, file), content);
  }
  const before = addModels(kind, target, hub);
  const migration =
    before !== undefined && options.migration !== false
      ? writeMigration(kind, target, before, hub, options.now)
      : undefined;
  writeManifest(target, manifest);
  return { manifest, kept, schemaChanged: before !== undefined, migration };
}

/**
 * @typedef {object} Status
 * @property {string} installed
 * @property {string} available
 * @property {string[]} modified   Edited since installed.
 * @property {string[]} missing    Deleted since installed.
 * @property {string[]} outdated   Different in the available version.
 * @property {string[]} adapterTemplatesChanged  Their template changed since they were created.
 */

/** @returns {Status} */
export function status(/** @type {string} */ target, /** @type {string} */ hub = ROOT) {
  const manifest = readManifest(target);
  if (manifest === undefined) throw new Error(`${target} has no connector (${MANIFEST})`);
  const kind = KINDS[manifest.kind];
  if (kind === undefined) throw new Error(`Unknown kind ${manifest.kind} in ${MANIFEST}`);
  const payload = payloadOf(kind, hub);
  /** @type {Status} */
  const result = {
    installed: manifest.version,
    available: versions(kind, hub).version,
    modified: [],
    missing: [],
    outdated: [],
    adapterTemplatesChanged: [],
  };
  for (const [file, hash] of Object.entries(manifest.files)) {
    const path = join(target, file);
    if (!existsSync(path)) result.missing.push(file);
    else if (sha256(readFileSync(path)) !== hash) result.modified.push(file);
    const next = payload.get(file);
    if (next === undefined || sha256(next) !== hash) result.outdated.push(file);
  }
  for (const file of payload.keys()) {
    if (!(file in manifest.files)) result.outdated.push(file);
  }
  for (const [file, content] of adaptersOf(kind, hub)) {
    const hash = manifest.adapters[file];
    if (hash !== undefined && sha256(content) !== hash) result.adapterTemplatesChanged.push(file);
  }
  return result;
}

/**
 * @typedef {object} UpdateResult
 * @property {string} from
 * @property {string} to
 * @property {string[]} replaced  Left alone by the project: now the new version.
 * @property {string[]} merged    Edited by the project, merged cleanly.
 * @property {string[]} conflicts Edited on both sides: conflict markers to resolve.
 * @property {string[]} added
 * @property {string[]} removed
 * @property {string[]} keptRemoved Gone upstream but edited here: kept.
 * @property {string[]} adapterTemplatesChanged
 * @property {boolean} schemaChanged  The connector's models changed in the Prisma schema.
 * @property {string | undefined} migration  The migration of that change.
 */

/** @returns {UpdateResult} */
export function update(
  /** @type {string} */ target,
  /** @type {string} */ hub = ROOT,
  /** @type {{ now?: Date }} */ options = {},
) {
  const manifest = readManifest(target);
  if (manifest === undefined)
    throw new Error(`${target} has no connector: use \`pnpm connector add\``);
  const kind = KINDS[manifest.kind];
  if (kind === undefined) throw new Error(`Unknown kind ${manifest.kind} in ${MANIFEST}`);
  const payload = payloadOf(kind, hub);
  const next = versions(kind, hub);
  // A version that changes the connector's tables updates the schema and
  // writes the migration of the change, which needs the project's Prisma:
  // checked before anything is touched.
  const schemaPath = kind.schema === undefined ? undefined : join(target, kind.schema);
  const before =
    schemaPath !== undefined && existsSync(schemaPath)
      ? readFileSync(schemaPath, 'utf8')
      : undefined;
  const nextSchema =
    before === undefined || !before.includes(BEGIN) ? undefined : withModelsOf(kind, before, hub);
  if (nextSchema !== undefined && prismaOf(kind, target) === undefined) {
    throw new Error(
      `Version ${next.version} changes the connector's tables: install the project's dependencies (pnpm install), then update again. Nothing was changed.`,
    );
  }
  /** @type {UpdateResult} */
  const result = {
    from: manifest.version,
    to: next.version,
    replaced: [],
    merged: [],
    conflicts: [],
    added: [],
    removed: [],
    keptRemoved: [],
    adapterTemplatesChanged: status(target, hub).adapterTemplatesChanged,
    schemaChanged: false,
    migration: undefined,
  };
  /** @type {Record<string, string>} */
  const files = {};
  for (const [file, content] of payload) {
    const path = join(target, file);
    const hash = manifest.files[file];
    files[file] = sha256(content);
    if (hash === undefined && existsSync(path) && sha256(readFileSync(path)) !== files[file]) {
      // New in this version, where the project has a file of its own: a
      // two-way merge (an empty base), never an overwrite.
      if (mergeFile(path, '', content, ['yours', 'nothing', `connector ${next.version}`])) {
        result.merged.push(file);
      } else {
        result.conflicts.push(file);
      }
    } else if (hash === undefined || !existsSync(path)) {
      write(path, content);
      result.added.push(file);
    } else if (sha256(readFileSync(path)) === hash) {
      if (hash !== files[file]) {
        write(path, content);
        result.replaced.push(file);
      }
    } else if (hash !== files[file]) {
      const base = readFileSync(pristinePath(target, file), 'utf8');
      if (
        mergeFile(path, base, content, [
          'yours',
          `installed ${manifest.version}`,
          `connector ${next.version}`,
        ])
      ) {
        result.merged.push(file);
      } else {
        result.conflicts.push(file);
      }
    }
    write(pristinePath(target, file), content);
  }
  for (const file of Object.keys(manifest.files)) {
    if (payload.has(file)) continue;
    const path = join(target, file);
    if (existsSync(path) && sha256(readFileSync(path)) !== manifest.files[file]) {
      result.keptRemoved.push(file);
    } else {
      rmSync(path, { force: true });
      result.removed.push(file);
    }
    rmSync(pristinePath(target, file), { force: true });
  }
  if (nextSchema !== undefined && before !== undefined && schemaPath !== undefined) {
    writeFileSync(schemaPath, nextSchema);
    result.schemaChanged = true;
    result.migration = writeMigration(kind, target, before, hub, options.now, manifest.version);
  }
  writeManifest(target, {
    ...manifest,
    version: next.version,
    contractVersion: next.contractVersion,
    files,
    // Reported once, by this update: the templates the adapters now compare to.
    adapters: Object.fromEntries(
      [...adaptersOf(kind, hub)].map(([file, content]) => [file, sha256(content)]),
    ),
  });
  return result;
}

/**
 * Three-way merge into `path` (git merge-file) of `base` and `theirs`, with
 * the labels of yours, the base and theirs; false when conflicts were left.
 */
function mergeFile(
  /** @type {string} */ path,
  /** @type {string} */ base,
  /** @type {string} */ theirs,
  /** @type {[string, string, string]} */ labels,
) {
  const scratch = mkdtempSync(join(tmpdir(), 'audit-connector-'));
  try {
    const basePath = join(scratch, 'base');
    const theirsPath = join(scratch, 'theirs');
    writeFileSync(basePath, base);
    writeFileSync(theirsPath, theirs);
    const [yours, original, upstream] = labels;
    // git merge-file exits with the number of conflicts (0: clean).
    try {
      execFileSync(
        'git',
        ['merge-file', '-L', yours, '-L', original, '-L', upstream, path, basePath, theirsPath],
        { stdio: 'ignore' },
      );
      return true;
    } catch (error) {
      const code = /** @type {{ status?: number }} */ (error).status;
      if (code === undefined || code < 1 || code > 127) throw error;
      return false;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The project's edits since `add`/`update`, and what the available version changes: unified diffs. */
export function diff(/** @type {string} */ target, /** @type {string} */ hub = ROOT) {
  const manifest = readManifest(target);
  if (manifest === undefined) throw new Error(`${target} has no connector (${MANIFEST})`);
  const kind = KINDS[manifest.kind];
  if (kind === undefined) throw new Error(`Unknown kind ${manifest.kind} in ${MANIFEST}`);
  const payload = payloadOf(kind, hub);
  /** @type {string[]} */
  const parts = [];
  const scratch = mkdtempSync(join(tmpdir(), 'audit-connector-'));
  const unified = (/** @type {string} */ a, /** @type {string} */ b) => {
    try {
      execFileSync('git', ['diff', '--no-index', '--no-color', a, b], { encoding: 'utf8' });
      return '';
    } catch (error) {
      return String(/** @type {{ stdout?: string }} */ (error).stdout ?? '');
    }
  };
  try {
    for (const file of Object.keys(manifest.files)) {
      const path = join(target, file);
      if (existsSync(path)) parts.push(unified(pristinePath(target, file), path));
      const next = payload.get(file);
      if (next !== undefined && sha256(next) !== manifest.files[file]) {
        const theirs = join(scratch, file.replaceAll('/', '_'));
        writeFileSync(theirs, next);
        parts.push(unified(pristinePath(target, file), theirs));
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return parts.filter((part) => part.length > 0).join('\n');
}

/** What is left to do after `add`, for the person running it. */
export function nextSteps(/** @type {ReturnType<typeof add>} */ result) {
  const installed = [
    `Installed ${result.manifest.connector} ${result.manifest.version} (contract ${String(result.manifest.contractVersion)}).`,
    ...(result.kept.length > 0 ? [`Kept the project's own: ${result.kept.join(', ')}.`] : []),
  ];
  if (result.manifest.kind === 'spa') {
    return [
      ...installed,
      "1. `pnpm add -D zod` in the web app: the contract's types and specs (the bundle gets none of it).",
      '2. The API: auditClientEvents in GET /api/auth/capabilities (its connector on); then `pnpm contract`.',
      '3. src/main.tsx: after the first render, import("./audit/audit.wiring") and startAudit() when the capabilities say auditClientEvents.',
      '4. reportAudit() where the page learns what the server cannot see: src/auth/return-path.ts, src/auth/session.ts.',
      "5. The account's activity: docs/audit/connection-guide.md#the-web-app.",
    ].join('\n');
  }
  if (result.manifest.kind === 'expo') {
    return [
      ...installed,
      '1. `pnpm expo install expo-crypto` (a native module: the next store build carries it).',
      "2. openapi/openapi.json: your API's, with the routes its connector adds; then `pnpm contract`.",
      '3. src/lib/storage/index.ts: auditInstallation in STORAGE_KEYS. src/api/client.ts and http.ts: the request headers (setRequestHeaders).',
      '4. src/app/_layout.tsx: audit.start(), bindUser on sign-in, sessionEnded on sign-out; beforeSignOut() before session.signOut().',
      '5. src/test/setup.ts: expo-sqlite and expo-crypto for the specs.',
      '6. Links, notifications and screens: docs/audit/connection-guide.md#the-mobile-app.',
    ].join('\n');
  }
  return [
    ...installed,
    result.migration === undefined
      ? result.schemaChanged
        ? '1. The models are in apps/api/prisma/schema.prisma. After `pnpm install`: `pnpm connector migration --target <this project>`, then `pnpm db:migrate`.'
        : '1. The schema had the models already.'
      : `1. Migration written: ${result.migration}. Apply it: \`pnpm db:migrate\`.`,
    '2. src/env/env.schema.ts: spread AUDIT_ENV_SHAPE into the schema and call checkAuditEnv(values, ctx) in its superRefine.',
    '3. src/app.module.ts: import AuditModule.forRoot(auditConfigFromEnv(env)), after MailModule.',
    '4. src/openapi/openapi.spec.ts: add /api/audit/webhooks to the public routes (Audit Hub signs it).',
    '5. Record the template flows: docs/audit/connection-guide.md#integration-points.',
    '6. Register the application in Audit Hub, set the AUDIT_HUB_* variables, redeploy.',
  ].join('\n');
}

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: 'string' },
      kind: { type: 'string', default: 'api' },
      check: { type: 'boolean', default: false },
      'no-migration': { type: 'boolean', default: false },
    },
  });
  const [command] = positionals;
  if (values.target === undefined || command === undefined) {
    console.error(
      'Usage: pnpm connector <add|status|diff|update|migration> --target <project> [--kind api|expo|spa]',
    );
    process.exit(2);
  }
  const target = resolve(values.target);
  if (command === 'add') {
    const result = add(target, values.kind, { migration: !values['no-migration'] });
    console.log(nextSteps(result));
  } else if (command === 'status') {
    const result = status(target);
    console.log(`Installed ${result.installed}, available ${result.available}.`);
    for (const [label, list] of /** @type {const} */ ([
      ['Edited here', result.modified],
      ['Missing', result.missing],
      ['Changed in the available version', result.outdated],
      ['Adapter templates changed (review by hand)', result.adapterTemplatesChanged],
    ])) {
      if (list.length > 0) console.log(`${label}:\n  ${list.join('\n  ')}`);
    }
    if (values.check && (result.modified.length > 0 || result.missing.length > 0)) process.exit(1);
  } else if (command === 'migration') {
    console.log(`Migration written: ${migration(target)}. Apply it: \`pnpm db:migrate\`.`);
  } else if (command === 'diff') {
    const text = diff(target);
    console.log(text.length === 0 ? 'No differences.' : text);
  } else if (command === 'update') {
    const result = update(target);
    console.log(`Updated ${result.from} → ${result.to}.`);
    if (result.migration !== undefined) {
      console.log(
        `The connector's tables changed: migration written, ${result.migration}. Apply it: \`pnpm db:migrate\`.`,
      );
    }
    for (const [label, list] of /** @type {const} */ ([
      ['Replaced', result.replaced],
      ['Merged with your edits', result.merged],
      ['CONFLICTS (resolve the markers)', result.conflicts],
      ['Added', result.added],
      ['Removed', result.removed],
      ['Gone upstream, kept (you edited them)', result.keptRemoved],
      ['Adapter templates changed (review by hand)', result.adapterTemplatesChanged],
    ])) {
      if (list.length > 0) console.log(`${label}:\n  ${list.join('\n  ')}`);
    }
    if (result.conflicts.length > 0) process.exit(1);
  } else {
    console.error(`Unknown command ${command}`);
    process.exit(2);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main();
