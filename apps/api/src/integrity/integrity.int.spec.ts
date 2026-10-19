import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import {
  batch,
  publishCatalog,
  registerApp,
  signed,
  type TestConnectedApp,
  testEvent,
} from '../../test/ingest.js';
import {
  ageEvents,
  bypassingTriggers as sharedBypass,
  moveEvents,
} from '../../test/time-travel.js';
import type { Prisma } from '../prisma/generated/client.js';
import { RetentionService } from '../retention/retention.service.js';
import { IntegrityStatusService } from './integrity-status.service.js';
import { SealerService } from './sealer.service.js';
import { VerifierService } from './verifier.service.js';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const ADMIN = '0199e0b1-0000-7000-8000-00000000000a';

// The audit log's guarantees against the real database (docs/adr/0007,
// docs/adr/0008): the API's role cannot change it, the owner cannot either,
// only retention and erasure delete (inside the database, within their
// rules), and a verification names whatever changed behind their back.
// The suite plays the attacker with what only a superuser has:
// session_replication_role = replica skips the triggers.
describe('audit log integrity (integration)', () => {
  let t: TestApp;
  let connected: TestConnectedApp;
  let version: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    connected = await registerApp(t.app);
    version = await publishCatalog(t.server, connected);
  });

  async function ingest(count: number, from = 1, actorId = 'user-1'): Promise<string[]> {
    const events = Array.from({ length: count }, (_, n) =>
      testEvent(version, from + n, {
        actor: { type: 'user', id: actorId, role: 'member', label: 'j***@e***.com' },
      }),
    );
    await signed(t.server, connected, 'POST', '/api/ingest/events', batch(events)).expect(200);
    const rows = await t.prisma.auditEvent.findMany({
      where: { eventId: { in: events.map((event) => event.eventId) } },
      orderBy: { sourceSeq: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** As the superuser, past the triggers (an attacker with the database's keys). */
  const bypassingTriggers = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
    sharedBypass(t.prisma, work);
  /** Sealing only takes windows 2 minutes old, retention only what its period allows. */
  const move = (ids: string[], to: (recordedAt: Date) => Date) => moveEvents(t.prisma, ids, to);
  const age = (ids: string[], ms: number) => ageEvents(t.prisma, ids, ms);

  /** In a transaction as app_runtime, the API's production role. */
  function asRuntime<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return t.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_runtime`;
      return work(tx);
    });
  }

  const purge = (cutoff: Date | string, retentionClass = 'security', trigger = 'job') =>
    t.prisma.$queryRaw<{ count: number }[]>`
      SELECT audit_purge(${connected.id}::uuid, ${retentionClass}::"RetentionClass", ${cutoff}::timestamptz, ${trigger}) AS "count"`.then(
      (rows) => rows[0]?.count,
    );

  const verify = () => t.app.get(VerifierService).verify({ trigger: 'cli' });
  const seal = () => t.app.get(SealerService).sealAll();

  describe('append-only', () => {
    it("refuses the API's role any update, delete or truncate of the audit tables", async () => {
      const [id = ''] = await ingest(1);
      for (const table of ['audit_events', 'event_personal', 'integrity_seals', 'legal_holds']) {
        const [rights] = await t.prisma.$queryRaw<
          { update: boolean; delete: boolean; truncate: boolean; insert: boolean }[]
        >`
          SELECT has_table_privilege('app_runtime', ${table}, 'UPDATE') AS "update",
                 has_table_privilege('app_runtime', ${table}, 'DELETE') AS "delete",
                 has_table_privilege('app_runtime', ${table}, 'TRUNCATE') AS "truncate",
                 has_table_privilege('app_runtime', ${table}, 'INSERT') AS "insert"`;
        expect(rights, table).toEqual({
          update: false,
          delete: false,
          truncate: false,
          insert: true,
        });
      }
      await expect(
        asRuntime(
          (tx) => tx.$executeRaw`UPDATE "audit_events" SET "action" = 'x' WHERE "id" = ${id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asRuntime((tx) => tx.$executeRaw`DELETE FROM "audit_events" WHERE "id" = ${id}::uuid`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asRuntime(
          (tx) => tx.$executeRaw`DELETE FROM "event_personal" WHERE "event_pk" = ${id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
      // What the API itself reports (app_database_privileges_ok).
      const [own] = await asRuntime(
        (tx) => tx.$queryRaw<{ mutable: boolean }[]>`
          SELECT has_table_privilege(current_user, 'audit_events', 'UPDATE') AS "mutable"`,
      );
      expect(own?.mutable).toBe(false);
    });

    it("refuses the tables' owner too: the trigger stands whatever the grants", async () => {
      const [id = ''] = await ingest(1);
      await expect(
        t.prisma.$executeRaw`UPDATE "audit_events" SET "action" = 'x' WHERE "id" = ${id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        t.prisma.$executeRaw`DELETE FROM "audit_events" WHERE "id" = ${id}::uuid`,
      ).rejects.toThrow(/append-only/);
      // The API's role setting the maintenance flag itself achieves nothing.
      await expect(
        t.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('audit.maintenance', 'on', true)`;
          await asRuntimeIn(tx);
          return tx.$executeRaw`DELETE FROM "event_personal" WHERE "event_pk" = ${id}::uuid`;
        }),
      ).rejects.toThrow(/permission denied/);
      expect(await t.prisma.auditEvent.count()).toBe(1);
    });

    it('sets recorded_at itself, and refuses a transaction without a short timeout', async () => {
      const [id = ''] = await ingest(1);
      const row = await t.prisma.auditEvent.findUniqueOrThrow({ where: { id } });
      const copy = {
        ...row,
        id: undefined,
        eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f99',
        sourceSeq: 99n,
        recordedAt: new Date('2020-01-01T00:00:00.000Z'),
        changeBefore: undefined,
        changeAfter: undefined,
        details: undefined,
      };
      await expect(t.prisma.auditEvent.create({ data: copy })).rejects.toThrow(
        /transaction_timeout/,
      );
      await expect(
        t.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL transaction_timeout = '60s'`;
          return tx.auditEvent.create({ data: copy });
        }),
      ).rejects.toThrow(/transaction_timeout/);
      const created = await t.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL transaction_timeout = '10s'`;
        return tx.auditEvent.create({ data: copy });
      });
      expect(Date.now() - created.recordedAt.getTime()).toBeLessThan(MINUTE_MS);
    });
  });

  describe('sealing and verification', () => {
    beforeEach(() => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    it('seals what ingestion wrote and verifies it, then names an edited event', async () => {
      const ids = await ingest(3);
      await age(ids, 10 * MINUTE_MS);
      await expect(seal()).resolves.toBe(1);
      await expect(seal()).resolves.toBe(0);
      await expect(verify()).resolves.toMatchObject({
        outcome: 'passed',
        sealsChecked: 1,
        eventsChecked: 3,
      });

      const target = ids[1] ?? '';
      await bypassingTriggers(
        (tx) =>
          tx.$executeRaw`UPDATE "audit_events" SET "actor_id" = 'intruder' WHERE "id" = ${target}::uuid`,
      );
      const report = await verify();
      expect(report.outcome).toBe('failed');
      expect(report.failures).toEqual([
        expect.objectContaining({ kind: 'event_modified', sealNo: '1', eventPk: target }),
      ]);
      const recorded = await t.prisma.integrityVerification.findUniqueOrThrow({
        where: { id: report.id },
      });
      expect(recorded).toMatchObject({ outcome: 'failed', failures: 1 });
      // The log names the event by its id, nothing of its content.
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining(`FAILED: 1 failure(s), the first event_modified`),
      );
      expect(Logger.prototype.error).not.toHaveBeenCalledWith(expect.stringContaining('intruder'));
    });

    it('names an event deleted, and one slipped into a sealed window', async () => {
      const ids = await ingest(3);
      await age(ids, 10 * MINUTE_MS);
      await seal();
      const [first = '', second = ''] = ids;
      await bypassingTriggers(async (tx) => {
        await tx.$executeRaw`DELETE FROM "event_personal" WHERE "event_pk" = ${first}::uuid`;
        await tx.$executeRaw`DELETE FROM "audit_events" WHERE "id" = ${first}::uuid`;
      });
      expect((await verify()).failures).toEqual([
        expect.objectContaining({ kind: 'event_deleted', eventPk: first }),
      ]);
      // A forged event with a correct content hash, in the sealed window.
      const [extra = ''] = await ingest(1, 10);
      const original = await t.prisma.auditEvent.findUniqueOrThrow({ where: { id: second } });
      await move([extra], () => original.recordedAt);
      const kinds = (await verify()).failures.map((failure) => [failure.kind, failure.eventPk]);
      expect(kinds).toContainEqual(['event_inserted', extra]);
    });

    it('detects a rewritten seal and keeps verifying a chain across many seals', async () => {
      const first = await ingest(2);
      await age(first, 20 * MINUTE_MS);
      await seal();
      // Right where the first seal ended: the next window starts there.
      const { windowTo } = await t.prisma.integritySeal.findFirstOrThrow();
      const second = await ingest(2, 3);
      await move(second, () => windowTo);
      await seal();
      await expect(verify()).resolves.toMatchObject({ outcome: 'passed', sealsChecked: 2 });
      await bypassingTriggers(
        (tx) => tx.$executeRaw`UPDATE "integrity_seals" SET "event_count" = 1 WHERE "seal_no" = 1`,
      );
      const kinds = (await verify()).failures.map((failure) => failure.kind);
      expect(kinds).toContain('seal_modified');
    });

    it('reports every stream, the verifications and the signed checkpoint', async () => {
      const ids = await ingest(2);
      await age(ids, 10 * MINUTE_MS);
      await seal();
      await ingest(1, 3);
      await verify();
      const checkpoint = await t.app.get(SealerService).checkpoint();
      expect(checkpoint?.digest).toMatch(/^[0-9a-f]{64}$/);
      const status = await t.app.get(IntegrityStatusService).status();
      expect(status.streams).toEqual([
        {
          appId: connected.id,
          slug: connected.slug,
          category: 'security',
          lastSealNo: '1',
          sealedThrough: expect.any(String) as unknown,
          unsealedEvents: 1,
        },
      ]);
      expect(status.verifications).toEqual([
        expect.objectContaining({ trigger: 'cli', outcome: 'passed', eventsChecked: '2' }),
      ]);
      expect(status.lastCheckpoint?.digest).toBe(checkpoint?.digest);
    });
  });

  describe('retention', () => {
    it('purges sealed events past their period and the verification accounts for them', async () => {
      const old = await ingest(2);
      await age(old, 800 * DAY_MS);
      const recent = await ingest(1, 3);
      await age(recent, 10 * MINUTE_MS);
      await seal();
      await expect(purge(new Date(Date.now() - 731 * DAY_MS))).resolves.toBe(2);
      expect(await t.prisma.auditEvent.count()).toBe(1);
      expect(await t.prisma.eventPersonal.count()).toBe(1);
      const [run] = await t.prisma.retentionRun.findMany({ include: { seals: true } });
      expect(run).toMatchObject({
        class: 'security',
        deletedCount: 2,
        heldCount: 0,
        trigger: 'job',
      });
      expect(run?.seals.map((row) => row.deletedCount)).toEqual([2]);
      await expect(verify()).resolves.toMatchObject({ outcome: 'passed', eventsChecked: 1 });
    });

    it('never purges inside the retention period, unsealed events or what a hold keeps', async () => {
      const ids = await ingest(2);
      await age(ids, 800 * DAY_MS);
      await expect(purge(new Date(Date.now() - 700 * DAY_MS))).rejects.toThrow(
        /inside the retention/,
      );
      await expect(purge(new Date(Date.now() - 731 * DAY_MS), 'security', 'cron')).rejects.toThrow(
        /unknown trigger/,
      );
      // Not sealed yet: nothing goes.
      await expect(purge(new Date(Date.now() - 731 * DAY_MS))).resolves.toBe(0);
      await seal();
      // A longer period set for the application wins over the minimum.
      await t.prisma.retentionPolicy.create({
        data: { appId: connected.id, class: 'security', days: 1000, updatedById: ADMIN },
      });
      await expect(purge(new Date(Date.now() - 731 * DAY_MS))).rejects.toThrow(
        /inside the retention/,
      );
      await expect(
        t.prisma.retentionPolicy.create({
          data: { appId: connected.id, class: 'audit', days: 30, updatedById: ADMIN },
        }),
      ).rejects.toThrow(/retention_policies_days_check/);
      await t.prisma.retentionPolicy.deleteMany();

      const hold = await t.prisma.legalHold.create({
        data: {
          appId: connected.id,
          caseRef: 'CASE-1',
          reason: 'Litigation about account user-1',
          actorId: 'user-1',
          createdById: ADMIN,
        },
      });
      await expect(purge(new Date(Date.now() - 731 * DAY_MS))).resolves.toBe(0);
      const [held] = await t.prisma.retentionRun.findMany({ orderBy: { startedAt: 'desc' } });
      expect(held).toMatchObject({ deletedCount: 0, heldCount: 2 });
      await t.prisma.legalHoldRelease.create({
        data: { holdId: hold.id, reason: 'Case closed by the court', releasedById: ADMIN },
      });
      await expect(purge(new Date(Date.now() - 731 * DAY_MS))).resolves.toBe(2);
      // Every event of the seal gone: its leaves go, its digest and count stay.
      expect(await t.prisma.integritySealLeaves.count()).toBe(0);
      await expect(verify()).resolves.toMatchObject({ outcome: 'passed' });
    });

    it("lets the API's role purge only through the database function", async () => {
      const ids = await ingest(1);
      await age(ids, 800 * DAY_MS);
      await seal();
      const cutoff = new Date(Date.now() - 731 * DAY_MS);
      const [row] = await asRuntime(
        (tx) => tx.$queryRaw<{ count: number }[]>`
          SELECT audit_purge(${connected.id}::uuid, 'security'::"RetentionClass", ${cutoff}, 'job') AS "count"`,
      );
      expect(row?.count).toBe(1);
    });

    it('runs the daily sweep as a recorded job', async () => {
      const ids = await ingest(1);
      await age(ids, 800 * DAY_MS);
      await seal();
      await t.app.get(RetentionService).scheduledSweep();
      const run = await t.prisma.jobRun.findFirstOrThrow({ where: { job: 'retention' } });
      expect(run).toMatchObject({ outcome: 'succeeded', detail: { security: 1 } });
      expect(await t.prisma.auditEvent.count()).toBe(0);
    });

    it('removes personal data at its own, shorter period and keeps the event', async () => {
      const ids = await ingest(1);
      await age(ids, 100 * DAY_MS);
      await expect(purge(new Date(Date.now() - 91 * DAY_MS), 'personal')).resolves.toBe(1);
      expect(await t.prisma.eventPersonal.count()).toBe(0);
      expect(await t.prisma.auditEvent.count()).toBe(1);
      await seal();
      await expect(verify()).resolves.toMatchObject({ outcome: 'passed' });
    });
  });

  describe('erasure', () => {
    const erase = (subject: string) =>
      t.prisma.$queryRaw<{ personal_deleted: number; location_deleted: number; held: number }[]>`
        SELECT * FROM audit_erase_subject(${connected.id}::uuid, ${subject}, 'panel')`.then(
        (rows) => rows[0],
      );

    it("removes a subject's personal rows, keeps the events verifiable, and respects holds", async () => {
      const mine = await ingest(2, 1, 'user-1');
      const theirs = await ingest(1, 3, 'user-2');
      await age([...mine, ...theirs], 10 * MINUTE_MS);
      await seal();
      await expect(erase('user-1')).resolves.toEqual({
        personal_deleted: 2,
        location_deleted: 0,
        held: 0,
      });
      expect(await t.prisma.eventPersonal.count()).toBe(1);
      expect(await t.prisma.auditEvent.count()).toBe(3);
      await expect(verify()).resolves.toMatchObject({ outcome: 'passed' });

      await t.prisma.legalHold.create({
        data: {
          appId: connected.id,
          caseRef: 'CASE-2',
          reason: 'Litigation about account user-2',
          actorId: 'user-2',
          createdById: ADMIN,
        },
      });
      await expect(erase('user-2')).resolves.toEqual({
        personal_deleted: 0,
        location_deleted: 0,
        held: 1,
      });
      expect(await t.prisma.erasureRun.count()).toBe(2);
      await expect(
        t.prisma
          .$queryRaw`SELECT * FROM audit_erase_subject(${connected.id}::uuid, 'user-1', 'email')`,
      ).rejects.toThrow(/unknown origin/);
    });

    it('deletes what the rules derived of the subject too, unless a hold keeps their events', async () => {
      await ingest(1, 1, 'user-1');
      const derived = async (actorId: string) => {
        const keys = { appId: connected.id, actorId };
        await t.prisma.actorProfile.create({ data: { ...keys, lastSeenAt: new Date() } });
        await t.prisma.actorDevice.create({
          data: {
            ...keys,
            deviceKey: 'd'.repeat(64),
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          },
        });
        await t.prisma.actorCountry.create({
          data: { ...keys, country: 'MX', firstSeenAt: new Date(), lastSeenAt: new Date() },
        });
      };
      const left = (actorId: string) =>
        Promise.all([
          t.prisma.actorProfile.count({ where: { actorId } }),
          t.prisma.actorDevice.count({ where: { actorId } }),
          t.prisma.actorCountry.count({ where: { actorId } }),
        ]);
      await derived('user-1');
      await erase('user-1');
      await expect(left('user-1')).resolves.toEqual([0, 0, 0]);

      await ingest(1, 2, 'user-2');
      await derived('user-2');
      await t.prisma.legalHold.create({
        data: {
          appId: connected.id,
          caseRef: 'CASE-12',
          reason: 'Litigation about account user-2',
          actorId: 'user-2',
          createdById: ADMIN,
        },
      });
      await erase('user-2');
      await expect(left('user-2')).resolves.toEqual([1, 1, 1]);
    });

    it("drops the personal data of an event that occurred before its subject's erasure and arrived after it", async () => {
      await erase('user-1');
      const before = new Date(Date.now() - 60 * MINUTE_MS).toISOString();
      const late = testEvent(version, 1, {
        occurredAt: before,
        actor: { type: 'user', id: 'user-1', role: 'member' },
      });
      const after = testEvent(version, 2, {
        actor: { type: 'user', id: 'user-1', role: 'member' },
      });
      const other = testEvent(version, 3, {
        occurredAt: before,
        actor: { type: 'user', id: 'user-9', role: 'member' },
      });
      await signed(
        t.server,
        connected,
        'POST',
        '/api/ingest/events',
        batch([late, after, other]),
      ).expect(200);
      const idOf = async (eventId: string) =>
        (await t.prisma.auditEvent.findFirstOrThrow({ where: { eventId }, select: { id: true } }))
          .id;
      const eraseLate = async (eventId: string) =>
        t.prisma.$queryRaw<{ erased: boolean }[]>`
          SELECT audit_erase_late(${await idOf(eventId)}::uuid) AS "erased"`.then(
          (rows) => rows[0]?.erased,
        );
      await expect(eraseLate(late.eventId)).resolves.toBe(true);
      await expect(eraseLate(late.eventId)).resolves.toBe(false);
      // After the erasure (the account stays), and another subject's: kept.
      await expect(eraseLate(after.eventId)).resolves.toBe(false);
      await expect(eraseLate(other.eventId)).resolves.toBe(false);
      expect(
        await t.prisma.eventPersonal.count({ where: { eventPk: await idOf(late.eventId) } }),
      ).toBe(0);
      expect(await t.prisma.eventPersonal.count()).toBe(2);
      await expect(verify()).resolves.toMatchObject({ outcome: 'passed' });
    });

    /** An erasure of scope events: its run, then the subject's events, as audit_delete_events deletes them. */
    async function eraseEvents(subject: string) {
      const [run] = await t.prisma.$queryRaw<{ run_id: string }[]>`
        SELECT * FROM audit_erase_subject(${connected.id}::uuid, ${subject}, 'connector', 'events')`;
      return run?.run_id ?? '';
    }
    const deleteEvents = (erasure: string | null) =>
      t.prisma.$queryRaw<{ deleted: number; held: number; unsealed: number }[]>`
        SELECT * FROM audit_delete_events(${connected.id}::uuid, ${erasure}::uuid)`.then(
        (rows) => rows[0],
      );

    it("deletes a subject's events at the controller's request, sealed ones first, the chain still verifying", async () => {
      const mine = await ingest(2, 1, 'user-1');
      const theirs = await ingest(1, 3, 'user-2');
      await age([...mine, ...theirs], 10 * MINUTE_MS);
      await seal();
      const late = await ingest(1, 4, 'user-1');
      const run = await eraseEvents('user-1');

      // The one ingested after the last seal waits for its own.
      await expect(deleteEvents(run)).resolves.toEqual({ deleted: 2, held: 0, unsealed: 1 });
      expect(await t.prisma.auditEvent.count()).toBe(2);
      const [deletion] = await t.prisma.retentionRun.findMany({
        where: { trigger: 'subject' },
        include: { seals: true },
      });
      expect(deletion).toMatchObject({ erasureRunId: run, deletedCount: 2, class: 'security' });
      expect(deletion?.seals.map((row) => row.deletedCount)).toEqual([2]);
      await expect(verify()).resolves.toMatchObject({ outcome: 'passed' });

      // Sealed in the next window, as it would be 2 minutes later.
      const { windowTo } = await t.prisma.integritySeal.findFirstOrThrow({
        orderBy: { sealNo: 'desc' },
      });
      await move(late, () => new Date(windowTo.getTime() + 1));
      await seal();
      await expect(deleteEvents(run)).resolves.toEqual({ deleted: 1, held: 0, unsealed: 0 });
      expect(await t.prisma.auditEvent.findMany({ select: { actorId: true } })).toEqual([
        { actorId: 'user-2' },
      ]);
      await expect(verify()).resolves.toMatchObject({ outcome: 'passed' });
    });

    it('keeps what a hold matches, and deletes nothing without an erasure of scope events', async () => {
      const ids = await ingest(2, 1, 'user-1');
      await age(ids, 10 * MINUTE_MS);
      await seal();
      await t.prisma.legalHold.create({
        data: {
          appId: connected.id,
          caseRef: 'CASE-3',
          reason: 'Litigation about account user-1',
          actorId: 'user-1',
          createdById: ADMIN,
        },
      });
      await expect(deleteEvents(await eraseEvents('user-1'))).resolves.toEqual({
        deleted: 0,
        held: 2,
        unsealed: 0,
      });
      const [personal] = await t.prisma.$queryRaw<{ run_id: string }[]>`
        SELECT * FROM audit_erase_subject(${connected.id}::uuid, 'user-1', 'panel', 'personal')`;
      await expect(deleteEvents(personal?.run_id ?? '')).rejects.toThrow(
        /no erasure of scope events/,
      );
      await expect(
        t.prisma
          .$queryRaw`SELECT * FROM audit_erase_subject(${connected.id}::uuid, 'user-1', 'panel', 'all')`,
      ).rejects.toThrow(/unknown scope/);
      expect(await t.prisma.auditEvent.count()).toBe(2);
    });
  });

  describe("an application's end of service", () => {
    const deleteLog = () =>
      t.prisma.$queryRaw<{ deleted: number; held: number; unsealed: number }[]>`
        SELECT * FROM audit_delete_events(${connected.id}::uuid, NULL)`.then((rows) => rows[0]);
    const finish = () =>
      t.prisma.$queryRaw<{ count: number }[]>`
        SELECT audit_finish_application_deletion(${connected.id}::uuid) AS "count"`.then(
        (rows) => rows[0]?.count,
      );
    const suspend = () =>
      t.prisma.connectedApp.update({ where: { id: connected.id }, data: { status: 'suspended' } });

    it('deletes the whole log of a suspended application, then what was derived from it', async () => {
      const ids = await ingest(3);
      await age(ids, 10 * MINUTE_MS);
      await seal();
      await expect(deleteLog()).rejects.toThrow(/suspend the application first/);
      await expect(finish()).rejects.toThrow(/suspend the application first/);

      await suspend();
      await expect(finish()).rejects.toThrow(/still has events/);
      await expect(deleteLog()).resolves.toEqual({ deleted: 3, held: 0, unsealed: 0 });
      expect(await t.prisma.auditEvent.count({ where: { appId: connected.id } })).toBe(0);
      const [run] = await t.prisma.retentionRun.findMany({ where: { trigger: 'decommission' } });
      expect(run).toMatchObject({ deletedCount: 3, erasureRunId: null });

      await expect(finish()).resolves.toBeGreaterThan(0);
      expect(await t.prisma.appKey.count({ where: { appId: connected.id } })).toBe(0);
      expect(await t.prisma.sequenceState.count({ where: { appId: connected.id } })).toBe(0);
      // The seals, the catalog and the runs stay: the verification still passes.
      expect(await t.prisma.integritySeal.count({ where: { appId: connected.id } })).toBe(1);
      await expect(verify()).resolves.toMatchObject({ outcome: 'passed' });
    });

    it('waits for what a hold keeps, and refuses to finish while a hold names the application', async () => {
      const ids = await ingest(1);
      await age(ids, 10 * MINUTE_MS);
      await seal();
      await suspend();
      const hold = await t.prisma.legalHold.create({
        data: {
          appId: connected.id,
          caseRef: 'CASE-4',
          reason: 'Audit of the application before its deletion',
          fromAt: new Date(0),
          createdById: ADMIN,
        },
      });
      await expect(deleteLog()).resolves.toEqual({ deleted: 0, held: 1, unsealed: 0 });
      await t.prisma.legalHoldRelease.create({
        data: { holdId: hold.id, reason: 'The audit is closed', releasedById: ADMIN },
      });
      await expect(deleteLog()).resolves.toEqual({ deleted: 1, held: 0, unsealed: 0 });
      await expect(finish()).resolves.toBeGreaterThan(0);
    });

    it("lets the API's role delete only through the database functions", async () => {
      const ids = await ingest(1);
      await age(ids, 10 * MINUTE_MS);
      await seal();
      await suspend();
      const [row] = await asRuntime(
        (tx) => tx.$queryRaw<{ deleted: number }[]>`
          SELECT * FROM audit_delete_events(${connected.id}::uuid, NULL)`,
      );
      expect(row?.deleted).toBe(1);
      await expect(
        asRuntime(
          (tx) => tx.$executeRaw`DELETE FROM "audit_events" WHERE "app_id" = ${connected.id}::uuid`,
        ),
      ).rejects.toThrow();
    });
  });
});

/** Switches an open transaction to app_runtime. */
async function asRuntimeIn(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SET LOCAL ROLE app_runtime`;
}
