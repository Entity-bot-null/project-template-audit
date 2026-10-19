import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from '../../test/app.js';
import { PrismaService } from './prisma.service.js';

// The rules of the audit tables that only the database states (CHECK
// constraints and partial unique indexes in the migrations): every writer,
// not only this code, is held to them (docs/design/audit-hub/data-model.md).
describe('Audit Hub data model (integration)', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const hash = () => randomBytes(32);

  async function app(slug = 'my-project') {
    return prisma.connectedApp.create({
      data: { slug, name: 'My project', environment: 'production', pseudonymKey: randomBytes(32) },
    });
  }

  function event(appId: string, overrides: Record<string, unknown> = {}) {
    return {
      appId,
      eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70',
      sequenceEpoch: '0199e0b1-0000-7000-8000-000000000001',
      sourceSeq: 1n,
      schemaVersion: 1,
      connectorName: 'audit-nestjs',
      connectorVersion: '0.1.0',
      occurredAt: new Date(),
      category: 'security' as const,
      action: 'auth.session.signed_in',
      outcome: 'success' as const,
      severity: 'info' as const,
      riskScore: 0,
      actorType: 'user' as const,
      actorId: 'user-1',
      contentHash: hash(),
      ...overrides,
    };
  }

  // Events are written the way the ingestion writes them: in a transaction
  // with a transaction_timeout, which the database requires (docs/adr/0008).
  function insertEvent(data: ReturnType<typeof event>) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL transaction_timeout = '10s'`;
      return tx.auditEvent.create({ data });
    });
  }

  it('refuses slugs unfit for metric labels and URLs', async () => {
    await expect(app('My Project')).rejects.toThrow(/connected_apps_slug_check/);
    await expect(app('ok-slug')).resolves.toMatchObject({ slug: 'ok-slug', status: 'active' });
  });

  it('holds events to the contract: actor, sequence, status and hash', async () => {
    const { id } = await app();
    await expect(insertEvent(event(id))).resolves.toMatchObject({
      appId: id,
    });
    const refused = [
      { actorId: null },
      { actorType: 'anonymous' as const, eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f71' },
      { sourceSeq: null, eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f72' },
      { httpStatus: 999, eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f73' },
      { contentHash: randomBytes(31), eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f74' },
      { actorEmailHmac: 'not-hex', eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f75' },
      { riskScore: 101, eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f76' },
    ];
    for (const overrides of refused) {
      await expect(insertEvent(event(id, overrides)), JSON.stringify(overrides)).rejects.toThrow();
    }
  });

  it('stores an event id and a sequence number once per application', async () => {
    const first = await app();
    const second = await app('other-app');
    await insertEvent(event(first.id));
    await expect(insertEvent(event(first.id))).rejects.toThrow();
    await expect(
      insertEvent(event(first.id, { eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f79' })),
    ).rejects.toThrow();
    await expect(insertEvent(event(second.id))).resolves.toBeDefined();
  });

  it('keeps one open alert per group key', async () => {
    const { id } = await app();
    const alert = {
      appId: id,
      rule: 'brute_force',
      severity: 'high' as const,
      groupKey: 'brute_force:my-project:user-1',
      title: 'Brute force',
      summary: {},
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    };
    const created = await prisma.alert.create({ data: alert });
    await expect(prisma.alert.create({ data: alert })).rejects.toThrow();
    await prisma.alert.update({
      where: { id: created.id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
    await expect(prisma.alert.create({ data: alert })).resolves.toBeDefined();
  });

  it('never lets the requester approve their own response action', async () => {
    const { id } = await app();
    const person = '0199e0b1-0000-7000-8000-00000000000a';
    const action = {
      appId: id,
      subject: 'user-1',
      action: 'revoke_sessions' as const,
      reason: 'Account taken over by someone else',
      status: 'pending_approval' as const,
      requestedById: person,
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    await expect(
      prisma.responseAction.create({ data: { ...action, approvedById: person } }),
    ).rejects.toThrow(/response_actions_approver_check/);
    await expect(
      prisma.responseAction.create({ data: { ...action, reason: 'short' } }),
    ).rejects.toThrow(/response_actions_reason_check/);
  });

  it('keeps the webhook outbox consistent', async () => {
    const { id } = await app();
    const delivery = {
      target: 'app' as const,
      type: 'ping',
      payload: {},
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await expect(prisma.webhookDelivery.create({ data: delivery })).rejects.toThrow(
      /webhook_deliveries_check/,
    );
    await expect(
      prisma.webhookDelivery.create({ data: { ...delivery, appId: id, status: 'sending' } }),
    ).rejects.toThrow(/webhook_deliveries_check/);
    await expect(
      prisma.webhookDelivery.create({ data: { ...delivery, appId: id } }),
    ).resolves.toBeDefined();
  });

  it('requires a legal hold to match something besides its application', async () => {
    const { id } = await app();
    const hold = {
      appId: id,
      caseRef: 'CASE-1',
      reason: 'Litigation about account 42',
      createdById: '0199e0b1-0000-7000-8000-00000000000a',
    };
    await expect(prisma.legalHold.create({ data: hold })).rejects.toThrow(
      /legal_holds_scope_check/,
    );
    await expect(
      prisma.legalHold.create({ data: { ...hold, actorId: 'user-42' } }),
    ).resolves.toBeDefined();
  });
});
