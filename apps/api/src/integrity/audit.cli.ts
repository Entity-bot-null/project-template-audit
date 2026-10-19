import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { canonicalJson, type EventHashInput, eventHashDocument } from 'audit-contract';
import { secretBoxFromConfig } from '../common/crypto/secret-box.js';
import { ConnectedAppsService, contexts } from '../connected-apps/connected-apps.service.js';
import { geoIpReaderFromFiles, hostingAsnsFromFile } from '../enrichment/geoip.js';
import { canonicalIp, ipScope } from '../enrichment/ip.js';
import { env } from '../env/env.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import { type EventRow, hashInputOf } from '../ingest/event-rows.js';
import { PrismaClient } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { sweepRetention } from '../retention/retention.service.js';
import { integrityKeyringFromEnv } from './integrity-keys.js';
import { IntegrityStatusService } from './integrity-status.service.js';
import { JobRunsService } from './job-runs.service.js';
import { decodeLeaves, GENESIS_HASH, hex, sealHash, sha256 } from './seal-math.js';
import { SealerService } from './sealer.service.js';
import { VerifierService } from './verifier.service.js';

// Audit Hub's integrity commands (docs/adr/0008, docs/incident-response.md).
// Locally (no `--` before the options: pnpm passes it on, and parseArgs refuses it):
//   pnpm --filter api audit status                       streams, seals, last verifications
//   pnpm --filter api audit verify [--app <slug>] [--since <ISO date>]
//   pnpm --filter api audit seal | checkpoint            run the sealer or a checkpoint now
//   pnpm --filter api audit retention                    run the retention sweep now
//   pnpm --filter api audit geoip [--ip <address>]       the loaded geolocation files, a lookup
//   pnpm --filter api audit export --app <slug> --from <ISO> --to <ISO> [--out <file>]
//   pnpm --filter api audit verify-export --file <file>  offline, without the database
//   pnpm --filter api audit secrets:reencrypt            after rotating AUDIT_SECRETS_KEY
//   pnpm --filter api audit app:delete --app <slug> --confirm <slug>
//                                                        a suspended application's log, at the end of its service
// in a deployment, with the API image (docs/deploy-vps.md):
//   docker compose ... run --rm -T api node dist/integrity/audit.cli.js status
// Events are named by their ids, never by a person's data.

const USAGE = `Usage:
  audit status
  audit verify [--app <slug>] [--since <ISO date>]
  audit seal | audit checkpoint
  audit retention
  audit geoip [--ip <address>]
  audit export --app <slug> --from <ISO date> --to <ISO date> [--out <file>]
  audit verify-export --file <file>
  audit secrets:reencrypt
  audit app:delete --app <slug> --confirm <slug>`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: 'string' },
    since: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    out: { type: 'string' },
    file: { type: 'string' },
    ip: { type: 'string' },
    confirm: { type: 'string' },
  },
});

function fail(message: string): never {
  throw new Error(message);
}

function date(value: string | undefined, name: string): Date {
  if (value === undefined) fail(`--${name} is required.\n${USAGE}`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`--${name}: not a date (${value})`);
  return parsed;
}

const command = positionals[0];
const prisma =
  command === 'verify-export' || command === 'geoip'
    ? undefined
    : new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
const service = () => prisma as unknown as PrismaService;

async function appIdOf(slug: string | undefined): Promise<string | undefined> {
  if (slug === undefined || prisma === undefined) return undefined;
  const app = await prisma.connectedApp.findUnique({ where: { slug }, select: { id: true } });
  if (app === null) fail(`No connected application "${slug}".`);
  return app.id;
}

async function status(): Promise<void> {
  const state = await new IntegrityStatusService(service()).status();
  console.log('Streams (application / category: last seal, sealed through, events waiting):');
  for (const stream of state.streams) {
    console.log(
      `  ${stream.slug} / ${stream.category}: seal ${stream.lastSealNo ?? '-'}, ${stream.sealedThrough ?? 'never sealed'}, ${String(stream.unsealedEvents)} waiting`,
    );
  }
  console.log('Latest verifications:');
  for (const run of state.verifications) {
    console.log(
      `  ${run.finishedAt}  ${run.id}  ${run.trigger}  ${run.outcome}  seals=${String(run.sealsChecked)} events=${run.eventsChecked} failures=${String(run.failures)}`,
    );
  }
  console.log(
    `Last checkpoint: ${state.lastCheckpoint === null ? 'none' : `${state.lastCheckpoint.createdAt} ${state.lastCheckpoint.digest}`}`,
  );
}

async function verify(): Promise<void> {
  const appId = await appIdOf(values.app);
  const report = await new VerifierService(service(), integrityKeyringFromEnv()).verify({
    trigger: 'cli',
    ...(appId === undefined ? {} : { appId }),
    ...(values.since === undefined ? {} : { since: date(values.since, 'since') }),
  });
  console.log(
    `Verification ${report.id}: ${report.outcome}, ${String(report.sealsChecked)} seals, ${String(report.eventsChecked)} events.`,
  );
  for (const failure of report.failures) {
    console.log(
      `  ${failure.kind}  ${failure.appId}/${failure.category}  seal ${failure.sealNo ?? '-'}${failure.eventPk === undefined ? '' : `  event ${failure.eventPk}`}`,
    );
  }
  if (report.outcome !== 'passed') process.exitCode = 1;
}

/** JSON Lines: the seals overlapping the period, their leaves, the events, a manifest. */
async function exportRange(): Promise<void> {
  const appId = await appIdOf(values.app);
  if (appId === undefined || prisma === undefined) fail(`--app is required.\n${USAGE}`);
  const from = date(values.from, 'from');
  const to = date(values.to, 'to');
  const out: WriteStream | NodeJS.WriteStream =
    values.out === undefined ? process.stdout : createWriteStream(values.out);
  const digest = createHash('sha256');
  let lines = 0;
  const write = (record: unknown) => {
    const line = `${canonicalJson(record)}\n`;
    digest.update(line);
    lines += 1;
    out.write(line);
  };
  write({
    type: 'export',
    version: 1,
    appId,
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: new Date().toISOString(),
  });
  const seals = await prisma.integritySeal.findMany({
    where: { appId, windowTo: { gt: from }, windowFrom: { lt: to } },
    orderBy: [{ category: 'asc' }, { sealNo: 'asc' }],
    include: { leaves: true },
  });
  // The first seal's prevHash links the export to the chain before it: a
  // checkpoint kept outside Audit Hub vouches for that.
  for (const seal of seals) {
    write({
      type: 'seal',
      category: seal.category,
      sealNo: seal.sealNo.toString(),
      windowFrom: seal.windowFrom.toISOString(),
      windowTo: seal.windowTo.toISOString(),
      eventCount: seal.eventCount,
      leavesDigest: hex(seal.leavesDigest),
      prevHash: hex(seal.prevHash),
      sealHash: hex(seal.sealHash),
      keyId: seal.keyId,
      signature: hex(seal.signature),
      leaves: seal.leaves === null ? null : hex(seal.leaves.leaves),
    });
  }
  let cursor: string | undefined;
  for (;;) {
    const events = await prisma.auditEvent.findMany({
      where: { appId, recordedAt: { gte: from, lt: to } },
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    if (events.length === 0) break;
    for (const event of events) {
      write({
        type: 'event',
        hashInput: hashInputOf(event as unknown as EventRow),
        contentHash: hex(event.contentHash),
      });
    }
    cursor = events.at(-1)?.id;
  }
  const manifest = { type: 'manifest', lines, sha256: digest.digest('hex') };
  out.write(`${canonicalJson(manifest)}\n`);
  if (out !== process.stdout) (out as WriteStream).end();
  console.error(`Exported ${String(lines - 1)} records; manifest sha256 ${manifest.sha256}.`);
}

interface ExportedSeal {
  type: 'seal';
  category: string;
  sealNo: string;
  windowFrom: string;
  windowTo: string;
  eventCount: number;
  leavesDigest: string;
  prevHash: string;
  sealHash: string;
  leaves: string | null;
}

/** Recomputes an export's hashes offline: no database, no key. */
async function verifyExport(): Promise<void> {
  if (values.file === undefined) fail(`--file is required.\n${USAGE}`);
  const digest = createHash('sha256');
  const problems: string[] = [];
  const seals: ExportedSeal[] = [];
  const hashes = new Map<string, string>();
  let appId = '';
  let lines = 0;
  for await (const line of createInterface({ input: createReadStream(values.file) })) {
    const record = JSON.parse(line) as { type: string } & Record<string, unknown>;
    if (record.type === 'manifest') {
      if (record.lines !== lines || record.sha256 !== digest.digest('hex'))
        problems.push('manifest: the file was changed');
      continue;
    }
    digest.update(`${line}\n`);
    lines += 1;
    if (record.type === 'export') appId = String(record.appId);
    if (record.type === 'seal') seals.push(record as unknown as ExportedSeal);
    if (record.type === 'event') {
      const input = record.hashInput as EventHashInput;
      const computed = hex(sha256(eventHashDocument(input)));
      if (computed !== record.contentHash)
        problems.push(`event ${input.id}: content hash does not match`);
      hashes.set(input.id, String(record.contentHash));
    }
  }
  const byCategory = new Map<string, ExportedSeal[]>();
  for (const seal of seals)
    byCategory.set(seal.category, [...(byCategory.get(seal.category) ?? []), seal]);
  for (const [category, chain] of byCategory) {
    let prev: string | undefined;
    for (const seal of chain) {
      if (prev !== undefined && seal.prevHash !== prev)
        problems.push(`${category} seal ${seal.sealNo}: chain broken`);
      const recomputed = hex(
        sealHash({
          appId,
          category,
          sealNo: BigInt(seal.sealNo),
          windowFrom: new Date(seal.windowFrom),
          windowTo: new Date(seal.windowTo),
          eventCount: seal.eventCount,
          leavesDigest: Buffer.from(seal.leavesDigest, 'hex'),
          prevHash: Buffer.from(seal.prevHash, 'hex'),
        }),
      );
      if (recomputed !== seal.sealHash)
        problems.push(`${category} seal ${seal.sealNo}: seal hash does not match`);
      if (seal.leaves !== null) {
        const leaves = Buffer.from(seal.leaves, 'hex');
        if (hex(sha256(leaves)) !== seal.leavesDigest)
          problems.push(`${category} seal ${seal.sealNo}: leaves do not match`);
        for (const leaf of decodeLeaves(leaves)) {
          const stored = hashes.get(leaf.eventPk);
          if (stored !== undefined && stored !== hex(leaf.contentHash)) {
            problems.push(`event ${leaf.eventPk}: not the event its seal holds`);
          }
        }
      }
      prev = seal.sealHash;
    }
    console.log(
      `${category}: head ${prev ?? hex(GENESIS_HASH)} (compare with a checkpoint kept outside Audit Hub)`,
    );
  }
  for (const problem of problems) console.log(`  ${problem}`);
  console.log(
    problems.length === 0 ? 'The export is consistent.' : `${String(problems.length)} problem(s).`,
  );
  if (problems.length > 0) process.exitCode = 1;
}

/** Which geolocation files are loaded and how old; with --ip, what they say of one address. */
function geoip(): void {
  const reader = geoIpReaderFromFiles({ city: env.GEOIP_CITY_DB_PATH, asn: env.GEOIP_ASN_DB_PATH });
  const hosting = hostingAsnsFromFile(env.GEOIP_HOSTING_ASNS_PATH);
  if (!reader.enabled) {
    console.log('IP geolocation is off: GEOIP_CITY_DB_PATH and GEOIP_ASN_DB_PATH are not set.');
    return;
  }
  console.log(`City database: ${env.GEOIP_CITY_DB_PATH ?? 'not set'}`);
  console.log(`ASN database: ${env.GEOIP_ASN_DB_PATH ?? 'not set'}`);
  console.log(`Oldest build: ${String(Math.floor(reader.ageDays() ?? 0))} days ago`);
  console.log(`Hosting ASNs: ${String(hosting.size)}`);
  if (values.ip === undefined) return;
  const ip = canonicalIp(values.ip);
  if (ip === undefined) fail(`--ip: not an IP address (${values.ip})`);
  const scope = ipScope(ip);
  if (scope !== 'public') {
    console.log(`${ip}: ${scope} address, never looked up`);
    return;
  }
  const place = reader.lookup(ip);
  console.log(
    `${ip}: ${JSON.stringify(place)}${place.asn !== undefined && hosting.has(place.asn) ? ' (hosting)' : ''}`,
  );
}

/** How long app:delete waits for the last events' seal (sealing takes windows 2 minutes old). */
const SEAL_WAIT_MS = 30_000;
const SEAL_WAIT_ROUNDS = 20;

/**
 * The end of a suspended application's service, to the end: its audit log in
 * batches, waiting for the last events' seal, then what Audit Hub derived
 * from it, and the application retired (docs/privacy/processor-contract.md).
 * Stops, and exits 1, while a legal hold keeps events or names it.
 */
async function deleteApp(): Promise<void> {
  if (prisma === undefined) return;
  const slug = values.app ?? fail(`--app is required.\n${USAGE}`);
  const app = await prisma.connectedApp.findUnique({ where: { slug }, select: { id: true } });
  if (app === null) fail(`No application ${slug}.`);
  const { box } = secretBoxFromConfig({
    secret: env.AUDIT_SECRETS_KEY,
    previous: env.AUDIT_SECRETS_KEY_PREVIOUS,
    fallback: env.JWT_ACCESS_SECRET,
  });
  const apps = new ConnectedAppsService(service(), box);
  let total = 0;
  let waits = 0;
  for (;;) {
    const { progress, retired } = await apps.deleteLog(app.id, values.confirm ?? '', 60_000);
    total += progress.deleted;
    if (progress.status === 'deleted') {
      if (retired) {
        await new HubAuditService(service(), apps).record({
          action: 'hub.app.deleted',
          actor: { type: 'service', id: 'audit-cli' },
          resource: { type: 'connected_app', id: app.id },
          details: { eventsDeleted: await apps.deletedEvents(app.id) },
        });
      }
      console.log(`${slug}: ${String(total)} event(s) deleted; the application is retired.`);
      return;
    }
    if (progress.status === 'held') {
      fail(
        `${slug}: ${String(total)} event(s) deleted; a legal hold keeps ${String(progress.held)} or names the application: release it, then run this again.`,
      );
    }
    if (progress.status === 'waiting') {
      waits += 1;
      if (waits > SEAL_WAIT_ROUNDS) {
        fail(
          `${slug}: ${String(progress.waiting)} event(s) still not sealed: is the sealer running?`,
        );
      }
      console.log(`${slug}: ${String(progress.waiting)} event(s) wait for their seal…`);
      await new Promise((resolve) => setTimeout(resolve, SEAL_WAIT_MS));
    }
  }
}

/** After rotating AUDIT_SECRETS_KEY: every secret sealed with the previous key, sealed again. */
async function reencrypt(): Promise<void> {
  if (prisma === undefined) return;
  const { box } = secretBoxFromConfig({
    secret: env.AUDIT_SECRETS_KEY,
    previous: env.AUDIT_SECRETS_KEY_PREVIOUS,
    fallback: env.JWT_ACCESS_SECRET,
  });
  let count = 0;
  for (const key of await prisma.appKey.findMany({ select: { id: true, secret: true } })) {
    if (!box.isStale(key.secret)) continue;
    const sealed = box.seal(box.open(key.secret, contexts.key(key.id)), contexts.key(key.id));
    await prisma.appKey.update({
      where: { id: key.id },
      data: { secret: sealed.ciphertext, encKeyId: sealed.keyId },
    });
    count += 1;
  }
  const apps = await prisma.connectedApp.findMany({
    select: { id: true, pseudonymKey: true, webhookSecret: true, webhookSecretPrevious: true },
  });
  for (const app of apps) {
    const reseal = (value: Uint8Array | null, context: string) =>
      value === null || value.length === 0 || !box.isStale(value)
        ? undefined
        : box.seal(box.open(value, context), context).ciphertext;
    const data = {
      pseudonymKey: reseal(app.pseudonymKey, contexts.pseudonym(app.id)),
      webhookSecret: reseal(app.webhookSecret, contexts.webhook(app.id)),
      webhookSecretPrevious: reseal(app.webhookSecretPrevious, contexts.webhookPrevious(app.id)),
    };
    const changed = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(changed).length === 0) continue;
    await prisma.connectedApp.update({ where: { id: app.id }, data: changed });
    count += Object.keys(changed).length;
  }
  console.log(`${String(count)} secret(s) sealed again with the current AUDIT_SECRETS_KEY.`);
}

try {
  switch (command) {
    case 'status':
      await status();
      break;
    case 'verify':
      await verify();
      break;
    case 'seal':
      console.log(
        `${String(await new SealerService(service(), integrityKeyringFromEnv()).sealAll())} seal(s) written.`,
      );
      break;
    case 'checkpoint': {
      const checkpoint = await new SealerService(service(), integrityKeyringFromEnv()).checkpoint();
      console.log(
        checkpoint === undefined
          ? 'Nothing sealed yet.'
          : `Checkpoint ${checkpoint.id}: ${checkpoint.digest}`,
      );
      break;
    }
    case 'retention': {
      const summary = await sweepRetention(service(), new JobRunsService(service()), 'cli', {
        log: () => undefined,
      });
      console.log(`Retention sweep done: ${JSON.stringify(summary)}`);
      break;
    }
    case 'export':
      await exportRange();
      break;
    case 'geoip':
      geoip();
      break;
    case 'verify-export':
      await verifyExport();
      break;
    case 'secrets:reencrypt':
      await reencrypt();
      break;
    case 'app:delete':
      await deleteApp();
      break;
    default:
      fail(USAGE);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
