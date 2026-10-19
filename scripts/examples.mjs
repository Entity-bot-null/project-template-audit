// `pnpm examples`: the connected example projects (docs/adr/0010), generated
// from the pinned template commits into .examples/<kind>/ (ignored by git),
// each its own project with its own lockfile and settings.
//
//   pnpm examples generate --kind web|app [--force]
//   pnpm examples save     --kind web|app
//
// `generate`:
//   1. clones the template at examples/<kind>/template.json's commit (from the
//      local checkout EXAMPLES_<KIND>_TEMPLATE when set: it is only read);
//   2. applies the template patches, examples/<kind>/template-patch/*.patch
//      (`git am`, a commit each): the changes the template's owner would make
//      to ship the connector, installed and off, and to fill the template's
//      gaps;
//   3. brings each connector a patch installed to this repository's version
//      (pnpm connector update), or adds it (pnpm connector add), with the
//      project's dependencies and the connector's migration;
//   4. commits that state inside the example (the base commit);
//   5. applies the overlay, examples/<kind>/overlay.patch: what the example
//      adds on top (its settings, its acceptance specs);
//   6. writes the example's .env files. The web example: its databases on
//      the development PostgreSQL of Audit Hub (other names), its ports
//      apart from both. The app example: the template's own (its mock API).
// `save` writes the example's changes since step 4 back to the overlay, and
// the commits between the pin and the base commit back to the template
// patches (`git format-patch`): edit a patch by rewriting its commit there.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import {
  adaptersOf,
  add,
  KINDS,
  MANIFEST,
  migration,
  PRISTINE_DIR,
  readManifest,
  update,
} from './connector.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} Pin
 * @property {string} repository
 * @property {string} commit
 * @property {string} connector The connector kind (pnpm connector --kind).
 * @property {{ kind: string; path: string }[]} [connectors] More than one, each in its own
 *   directory of the project ('' for its root): the API's at the root, the SPA's in apps/web.
 */

/** Where each connector of an example goes: its kind, and its directory in the project. */
export function installsOf(/** @type {Pin} */ pin) {
  return pin.connectors ?? [{ kind: pin.connector, path: '' }];
}

/** The example's settings: databases and ports apart from Audit Hub's and the template's own. */
export const EXAMPLE_ENV = {
  web: {
    database: 'example_web',
    apiPort: '3400',
    webPort: '5373',
  },
};

export const exampleDir = (/** @type {string} */ kind) => join(ROOT, '.examples', kind);
/** examples/<kind>/template-patch/: the template patches, a `git format-patch` series (ADR 0010). */
export const templatePatchDir = (/** @type {string} */ kind) =>
  join(ROOT, 'examples', kind, 'template-patch');

/** The template patches of a kind, in their order; none when it has no series. */
export function templatePatchesOf(/** @type {string} */ kind) {
  const dir = templatePatchDir(kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.patch'))
    .sort()
    .map((name) => join(dir, name));
}

// Who commits inside a generated example: never the user's identity. A
// template patch keeps its own author.
const EXAMPLES_IDENTITY = [
  '-c',
  'user.name=examples',
  '-c',
  'user.email=examples@audit-hub.invalid',
];

/**
 * Applies a series of template patches on a clone, as the template's owner
 * would (`git am`, a commit each, their authors and dates kept).
 */
export function applyTemplatePatches(
  /** @type {string} */ dir,
  /** @type {readonly string[]} */ patches,
) {
  if (patches.length === 0) return;
  git(dir, [...EXAMPLES_IDENTITY, 'am', '--quiet', '--3way', '--whitespace=nowarn', ...patches]);
}

export const overlayPath = (/** @type {string} */ kind) =>
  join(ROOT, 'examples', kind, 'overlay.patch');

/** @returns {Pin} */
export function pinOf(/** @type {string} */ kind) {
  const path = join(ROOT, 'examples', kind, 'template.json');
  if (!existsSync(path)) throw new Error(`No example ${kind} (examples/${kind}/template.json)`);
  const pin = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof pin.repository !== 'string' || pin.repository === '')
    throw new Error(`${path}: repository is required`);
  if (!/^[0-9a-f]{40}$/.test(String(pin.commit)))
    throw new Error(`${path}: commit must be a full SHA`);
  if (!Object.hasOwn(KINDS, String(pin.connector)))
    throw new Error(`${path}: connector must be one of ${Object.keys(KINDS).join(', ')}`);
  if (pin.connectors !== undefined) {
    const valid =
      Array.isArray(pin.connectors) &&
      pin.connectors.length > 0 &&
      pin.connectors.every(
        (/** @type {{ kind?: unknown; path?: unknown }} */ entry) =>
          Object.hasOwn(KINDS, String(entry.kind)) &&
          typeof entry.path === 'string' &&
          /^(?:[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*)?$/.test(entry.path),
      );
    if (!valid)
      throw new Error(`${path}: connectors must be [{ kind, path }], each path inside it`);
  }
  return pin;
}

/** Runs a command in `cwd`, its output on this terminal. */
function run(
  /** @type {string} */ cwd,
  /** @type {string} */ command,
  /** @type {string[]} */ args,
  /** @type {NodeJS.ProcessEnv} */ env = process.env,
) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env });
}

const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

/** A setting of Audit Hub's own development environment (its .env files), or its default. */
export function hubVariable(
  /** @type {string} */ file,
  /** @type {string} */ name,
  /** @type {string} */ fallback,
) {
  const path = join(ROOT, file);
  const value = existsSync(path) ? parseEnv(readFileSync(path, 'utf8'))[name] : undefined;
  return value === undefined || value === '' ? fallback : value;
}

/** The development database URL of Audit Hub, from apps/api/.env, with the example's database name. */
export function exampleDatabaseUrl(/** @type {string} */ name) {
  const url = new URL(
    hubVariable('apps/api/.env', 'DATABASE_URL', 'postgresql://app:app@localhost:5452/app'),
  );
  url.pathname = `/${name}`;
  return url.toString();
}

/** Sets `name=value` in an env file's text, replacing a line that sets or comments it. */
export function setVariable(
  /** @type {string} */ text,
  /** @type {string} */ name,
  /** @type {string} */ value,
) {
  // The line that sets it, else one that comments it out: the last line
  // setting a name wins in an env file, so a live one is never left behind.
  // Compared as text: a name is never read as a pattern.
  const lines = text.split('\n');
  const sets = (/** @type {string} */ line) => line.trimStart().startsWith(`${name}=`);
  const comments = (/** @type {string} */ line) =>
    line.startsWith('#') && line.slice(1).trimStart().startsWith(`${name}=`);
  let index = lines.findIndex(sets);
  if (index === -1) index = lines.findIndex(comments);
  if (index === -1) return `${text.trimEnd()}\n${name}=${value}\n`;
  // A file with Windows line ends keeps them.
  lines[index] = `${name}=${value}${lines[index]?.endsWith('\r') === true ? '\r' : ''}`;
  return lines.join('\n');
}

function writeEnv(/** @type {string} */ dir, /** @type {string} */ kind) {
  if (kind === 'app') {
    // The template's development settings as they are: its mock API, 4010.
    const example = join(dir, '.env.example');
    if (existsSync(example)) writeFileSync(join(dir, '.env'), readFileSync(example, 'utf8'));
    return;
  }
  const settings = EXAMPLE_ENV[/** @type {keyof typeof EXAMPLE_ENV} */ (kind)];
  if (settings === undefined) return;
  const apiExample = join(dir, 'apps/api/.env.example');
  if (existsSync(apiExample)) {
    let text = readFileSync(apiExample, 'utf8');
    text = setVariable(text, 'DATABASE_URL', exampleDatabaseUrl(settings.database));
    text = setVariable(text, 'PORT', settings.apiPort);
    text = setVariable(text, 'APP_ORIGIN', `http://localhost:${settings.webPort}`);
    // A development secret of its own, as the template's manual has one made.
    text = setVariable(text, 'JWT_ACCESS_SECRET', randomBytes(32).toString('hex'));
    // Audit Hub's development services: its database server above, its Mailpit here.
    text = setVariable(
      text,
      'MAIL_SMTP_URL',
      hubVariable('apps/api/.env', 'MAIL_SMTP_URL', 'smtp://localhost:1045'),
    );
    writeFileSync(join(dir, 'apps/api/.env'), text);
  }
  const rootExample = join(dir, '.env.example');
  if (existsSync(rootExample)) {
    // Where the example's specs read the messages: Audit Hub's Mailpit.
    const text = setVariable(
      readFileSync(rootExample, 'utf8'),
      'MAILPIT_UI_PORT',
      hubVariable('.env', 'MAILPIT_UI_PORT', '8045'),
    );
    writeFileSync(join(dir, '.env'), text);
  }
}

/**
 * The date of the connector's migration in an example: a second after the
 * template's newest one. Always after them, and the same on every generate,
 * so the example's databases keep their history from one to the next.
 */
export function migrationDate(/** @type {string} */ migrations) {
  const newest = readdirSync(migrations)
    .filter((name) => /^\d{14}_/.test(name) && !/_(add|update)_audit_connector$/.test(name))
    .map((name) => name.slice(0, 14))
    .sort()
    .at(-1);
  if (newest === undefined) throw new Error(`No migration of the template in ${migrations}`);
  const at = newest.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z');
  return new Date(Date.parse(at) + 1000);
}

export function generate(
  /** @type {string} */ kind,
  /** @type {{ force?: boolean }} */ options = {},
) {
  const pin = pinOf(kind);
  const dir = exampleDir(kind);
  if (existsSync(dir)) {
    if (!options.force) throw new Error(`${dir} exists: --force replaces it`);
    rmSync(dir, { recursive: true, force: true });
  }
  const local = process.env[`EXAMPLES_${kind.toUpperCase()}_TEMPLATE`];
  run(ROOT, 'git', ['clone', '--quiet', local ?? pin.repository, dir]);
  git(dir, ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', pin.commit]);
  git(dir, ['switch', '--quiet', '-c', 'example']);
  const patches = templatePatchesOf(kind);
  applyTemplatePatches(dir, patches);
  // An update that changes the connector's tables needs the project's Prisma.
  if (patches.length > 0) run(dir, 'pnpm', ['install', '--frozen-lockfile']);

  const installed = installsOf(pin).map((install) => {
    const target = join(dir, install.path);
    // Shipped by a template patch: brought to this repository's version, as a
    // project updates it (the update writes its own migration).
    if (readManifest(target) !== undefined) {
      const updated = update(target);
      return { ...install, added: false, schemaChanged: updated.schemaChanged };
    }
    const added = add(target, install.kind, { migration: false });
    return { ...install, added: true, schemaChanged: added.schemaChanged };
  });
  run(dir, 'pnpm', ['install', '--frozen-lockfile']);
  /** @type {string | undefined} */
  let migrationPath;
  for (const { kind, path, added, schemaChanged } of installed) {
    const schema = KINDS[kind]?.schema;
    if (!added || !schemaChanged || schema === undefined) continue;
    const target = join(dir, path);
    migrationPath = migration(
      target,
      ROOT,
      migrationDate(join(target, dirname(schema), 'migrations')),
    );
  }
  git(dir, ['add', '--all']);
  // Always a commit, empty when the patches shipped the connector at this
  // version already: the base is HEAD, the template patches HEAD's ancestors.
  git(dir, [
    ...EXAMPLES_IDENTITY,
    'commit',
    '--quiet',
    '--no-verify',
    '--allow-empty',
    '-m',
    installed.some((install) => install.added)
      ? 'chore: install the Audit Hub connector'
      : 'chore: update the Audit Hub connector',
  ]);

  const overlay = overlayPath(kind);
  if (existsSync(overlay)) {
    git(dir, ['apply', '--whitespace=nowarn', overlay]);
    // The overlay may change the lockfile or the dependencies' scripts: install again.
    run(dir, 'pnpm', ['install', '--frozen-lockfile']);
  }
  writeEnv(dir, kind);
  return { dir, migration: migrationPath, overlay: existsSync(overlay) };
}

/**
 * What the connector owns in a generated example, as pathspecs that leave it
 * out of a diff: its manifest and pristine copies, its files (installed now
 * and at the base commit, so a file it no longer ships is not a deletion of
 * the example's), its migration, and each adapter still as its template
 * makes it. `generate` installs all of them afresh from packages/: the
 * overlay never carries them, and a connector change never needs a new one.
 * `paths`: the directories of the example with a connector ('' its root).
 */
export function connectorExclusions(
  /** @type {string} */ dir,
  /** @type {readonly string[]} */ paths = [''],
) {
  /** @type {string[]} */
  const pathspecs = [];
  for (const at of paths) pathspecs.push(...exclusionsAt(dir, at));
  return pathspecs;
}

/** connectorExclusions for the connector in `at`, a directory of the example. */
function exclusionsAt(/** @type {string} */ dir, /** @type {string} */ at) {
  const prefix = at === '' ? '' : `${at}/`;
  const manifest = readManifest(join(dir, at));
  if (manifest === undefined) throw new Error(`${join(dir, at)} has no ${MANIFEST}`);
  const kind = KINDS[manifest.kind];
  if (kind === undefined) throw new Error(`Unknown kind ${manifest.kind} in ${MANIFEST}`);
  /** @type {{ files: Record<string, string> }} */
  const base = JSON.parse(git(dir, ['show', `HEAD:${prefix}${MANIFEST}`]));
  const owned = new Set(
    [MANIFEST, PRISTINE_DIR, ...Object.keys(manifest.files), ...Object.keys(base.files)].map(
      (file) => `${prefix}${file}`,
    ),
  );
  for (const [relative, template] of adaptersOf(kind)) {
    const file = `${prefix}${relative}`;
    const path = join(dir, file);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    const base = committed(dir, file);
    if (current === undefined || current === template || current === base) {
      // As generate makes it, or as the base had it: nothing of the example's.
      owned.add(file);
    } else if (base !== template) {
      // Edited from another template than the current one: a patch against
      // that base would not apply to a fresh one.
      throw new Error(
        `${file}: edited from an older template of the adapter. Keep the edit aside, regenerate (pnpm examples generate --force), and make it again.`,
      );
    }
  }
  const pathspecs = [...owned].sort().map((path) => `:(exclude,literal)${path}`);
  if (kind.schema !== undefined) {
    const migrations = posix.join(at, posix.dirname(kind.schema), 'migrations');
    pathspecs.push(`:(exclude,glob)${migrations}/*_audit_connector/**`);
  }
  return pathspecs;
}

/** The directories of the example with a connector: where its base commit has a manifest. */
export function connectorPaths(/** @type {string} */ dir) {
  return git(dir, ['ls-files', '--', MANIFEST, `*/${MANIFEST}`])
    .split('\n')
    .filter((file) => file !== '')
    .map((file) => posix.dirname(file))
    .map((path) => (path === '.' ? '' : path))
    .sort();
}

/** A file's content at the base commit, or undefined when the base has none. */
function committed(/** @type {string} */ dir, /** @type {string} */ file) {
  try {
    return execFileSync('git', ['show', `HEAD:${file}`], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

/** Writes the example's own changes since the connector was installed back to its overlay. */
export function save(/** @type {string} */ kind) {
  const dir = exampleDir(kind);
  if (!existsSync(join(dir, '.git')))
    throw new Error(`No generated example in ${dir}: pnpm examples generate --kind ${kind}`);
  git(dir, ['add', '--intent-to-add', '--all']);
  // A patch `git apply` reads whatever the user's git settings.
  const patch = git(dir, [
    'diff',
    '--binary',
    '--no-color',
    '--no-ext-diff',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    'HEAD',
    '--',
    '.',
    ...connectorExclusions(dir, connectorPaths(dir)),
  ]);
  // Nothing of its own on top of the template patches: no overlay to apply.
  if (patch === '') rmSync(overlayPath(kind), { force: true });
  else writeFileSync(overlayPath(kind), patch);
  return {
    path: overlayPath(kind),
    bytes: Buffer.byteLength(patch),
    patches: saveTemplatePatches(kind, dir),
  };
}

/**
 * Writes the template patches back from the example: the commits between the
 * pinned template commit and the base commit, as `git format-patch` writes
 * them (no commit ids, no git version: the same series gives the same files).
 * Answers how many; none for a kind without a pin.
 */
function saveTemplatePatches(/** @type {string} */ kind, /** @type {string} */ dir) {
  if (!existsSync(join(ROOT, 'examples', kind, 'template.json'))) return 0;
  const range = `${pinOf(kind).commit}..HEAD^`;
  const count = Number(git(dir, ['rev-list', '--count', range]).trim());
  for (const old of templatePatchesOf(kind)) rmSync(old);
  if (count === 0) return 0;
  git(dir, [
    'format-patch',
    '--quiet',
    '--no-signature',
    '--zero-commit',
    '--no-color',
    '--output-directory',
    templatePatchDir(kind),
    range,
  ]);
  return count;
}

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      kind: { type: 'string', default: 'web' },
      force: { type: 'boolean', default: false },
    },
  });
  const [command] = positionals;
  if (command === 'generate') {
    const result = generate(values.kind, { force: values.force });
    console.log(`Generated ${result.dir}${result.overlay ? ', with its overlay' : ''}.`);
  } else if (command === 'save') {
    const result = save(values.kind);
    console.log(
      result.bytes > 0
        ? `Saved ${String(result.bytes)} bytes to ${result.path}.`
        : `No overlay: the example adds nothing on top of its template patches.`,
    );
    if (result.patches > 0) {
      console.log(
        `Saved ${String(result.patches)} template patches to ${templatePatchDir(values.kind)}.`,
      );
    }
  } else {
    console.error('Usage: pnpm examples <generate|save> --kind web|app [--force]');
    process.exit(2);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main();
