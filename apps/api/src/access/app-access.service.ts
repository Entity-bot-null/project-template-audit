import { Injectable } from '@nestjs/common';
import type { RequestUser } from '../common/types/request-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { VisibleAppsResponse } from './dto/access.schemas.js';

/** The applications a caller may see: every one, or a list (possibly empty). */
export type VisibleApps = 'all' | readonly string[];

// Which connected applications a person may see (docs/security.md#authorization):
// an admin every one; an auditor or a viewer the ones assigned to them
// (user_app_assignments); a member none. Services apply it next to their
// queries, and answer a record of an application the caller may not see
// exactly as one that does not exist (404), so ids cannot be probed.
@Injectable()
export class AppAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async visibleApps(user: RequestUser): Promise<VisibleApps> {
    if (user.role === 'admin') return 'all';
    if (user.role === 'member') return [];
    const rows = await this.prisma.userAppAssignment.findMany({
      where: { userId: user.id },
      select: { appId: true },
    });
    return rows.map((row) => row.appId);
  }

  /**
   * The applications the caller may see, by name: every one for an
   * administrator (Audit Hub's own included), the assigned ones for an
   * auditor or a viewer, none for a member.
   */
  async listVisible(user: RequestUser): Promise<VisibleAppsResponse> {
    const visible = await this.visibleApps(user);
    if (visible !== 'all' && visible.length === 0) return { items: [] };
    const rows = await this.prisma.connectedApp.findMany({
      where: visible === 'all' ? {} : { id: { in: [...visible] }, system: false },
      orderBy: [{ system: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, environment: true, status: true, system: true },
    });
    return { items: rows.map(({ id, ...app }) => ({ appId: id, ...app })) };
  }

  async canSee(user: RequestUser, appId: string): Promise<boolean> {
    const visible = await this.visibleApps(user);
    return visible === 'all' || visible.includes(appId);
  }

  /** Whether the caller may act on the application's alerts (an auditor or an admin who sees it). */
  async canManage(user: RequestUser, appId: string): Promise<boolean> {
    if (user.role !== 'admin' && user.role !== 'auditor') return false;
    return this.canSee(user, appId);
  }

  /** A Prisma filter on appId for the caller's applications. */
  async appFilter(user: RequestUser): Promise<{ appId?: { in: string[] } }> {
    const visible = await this.visibleApps(user);
    return visible === 'all' ? {} : { appId: { in: [...visible] } };
  }
}
