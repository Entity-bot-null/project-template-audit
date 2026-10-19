import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DatabasePrivilegesService } from './database-privileges.service.js';

function service(rows: Promise<unknown[]>) {
  const prisma = { $queryRaw: vi.fn(() => rows) };
  return new DatabasePrivilegesService(prisma as unknown as PrismaService);
}

describe('DatabasePrivilegesService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('is unknown until checked, and ok when no append-only table is writable', async () => {
    const privileges = service(
      Promise.resolve([
        { table: 'audit_events', mutable: false },
        { table: 'event_personal', mutable: false },
      ]),
    );
    expect(privileges.health()).toBe('unknown');
    await privileges.onApplicationBootstrap();
    expect(privileges.health()).toBe('ok');
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('names the tables a role too broad can change (a note outside production)', async () => {
    const privileges = service(
      Promise.resolve([
        { table: 'audit_events', mutable: true },
        { table: 'integrity_seals', mutable: true },
      ]),
    );
    await expect(privileges.check()).resolves.toBe('too_broad');
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('can update or delete audit_events, integrity_seals'),
    );
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('is unknown when the database cannot answer', async () => {
    const privileges = service(Promise.reject(new Error('timeout')));
    await expect(privileges.check()).resolves.toBe('unknown');
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not check the database privileges'),
    );
  });
});
