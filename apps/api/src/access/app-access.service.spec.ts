import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AppAccessService } from './app-access.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const OTHER = '0199e0b1-0000-7000-8000-000000000002';

const ROW = {
  id: APP,
  slug: 'shop',
  name: 'Shop',
  environment: 'production',
  status: 'active',
  system: false,
};

function setup(assigned: string[] = [APP]) {
  const prisma = {
    userAppAssignment: {
      findMany: vi.fn(() => Promise.resolve(assigned.map((appId) => ({ appId })))),
    },
    connectedApp: {
      findMany: vi.fn((_args: unknown) => Promise.resolve([ROW])),
    },
  };
  return { prisma, access: new AppAccessService(prisma as unknown as PrismaService) };
}

describe('AppAccessService', () => {
  it('shows an admin every application, without reading assignments', async () => {
    const { prisma, access } = setup();
    const admin = { id: 'a', role: 'admin' as const };
    await expect(access.visibleApps(admin)).resolves.toBe('all');
    await expect(access.appFilter(admin)).resolves.toEqual({});
    await expect(access.canSee(admin, OTHER)).resolves.toBe(true);
    await expect(access.canManage(admin, OTHER)).resolves.toBe(true);
    expect(prisma.userAppAssignment.findMany).not.toHaveBeenCalled();
  });

  it('shows auditors and viewers their assigned applications; only auditors manage', async () => {
    const { access } = setup();
    const auditor = { id: 'b', role: 'auditor' as const };
    const viewer = { id: 'c', role: 'viewer' as const };
    await expect(access.appFilter(auditor)).resolves.toEqual({ appId: { in: [APP] } });
    await expect(access.canSee(auditor, APP)).resolves.toBe(true);
    await expect(access.canSee(auditor, OTHER)).resolves.toBe(false);
    await expect(access.canManage(auditor, APP)).resolves.toBe(true);
    await expect(access.canManage(auditor, OTHER)).resolves.toBe(false);
    await expect(access.canSee(viewer, APP)).resolves.toBe(true);
    await expect(access.canManage(viewer, APP)).resolves.toBe(false);
  });

  it('shows a member nothing', async () => {
    const { access } = setup();
    const member = { id: 'd', role: 'member' as const };
    await expect(access.visibleApps(member)).resolves.toEqual([]);
    await expect(access.appFilter(member)).resolves.toEqual({ appId: { in: [] } });
  });

  describe('listVisible', () => {
    const select = {
      id: true,
      slug: true,
      name: true,
      environment: true,
      status: true,
      system: true,
    };
    const orderBy = [{ system: 'asc' }, { name: 'asc' }];

    it("lists every application for an administrator, Audit Hub's own included", async () => {
      const { prisma, access } = setup();
      await expect(access.listVisible({ id: 'a', role: 'admin' })).resolves.toEqual({
        items: [
          {
            appId: APP,
            slug: 'shop',
            name: 'Shop',
            environment: 'production',
            status: 'active',
            system: false,
          },
        ],
      });
      expect(prisma.connectedApp.findMany).toHaveBeenCalledWith({ where: {}, orderBy, select });
    });

    it('lists the assigned ones for an auditor, never the system application', async () => {
      const { prisma, access } = setup([APP, OTHER]);
      await access.listVisible({ id: 'b', role: 'auditor' });
      expect(prisma.connectedApp.findMany).toHaveBeenCalledWith({
        where: { id: { in: [APP, OTHER] }, system: false },
        orderBy,
        select,
      });
    });

    it('answers nothing, without a query, to a member or someone with no assignment', async () => {
      const { prisma, access } = setup([]);
      await expect(access.listVisible({ id: 'c', role: 'viewer' })).resolves.toEqual({ items: [] });
      await expect(access.listVisible({ id: 'd', role: 'member' })).resolves.toEqual({ items: [] });
      expect(prisma.connectedApp.findMany).not.toHaveBeenCalled();
    });
  });
});
