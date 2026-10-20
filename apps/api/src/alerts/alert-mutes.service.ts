import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppAccessService } from '../access/app-access.service.js';
import type { RequestUser } from '../common/types/request-user.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AlertMuteResponse, CreateAlertMuteDto } from './dto/alert.schemas.js';
import { RULES } from './rule-catalog.js';

type Db = Prisma.TransactionClient | PrismaService;

/** A silence in force: of one rule of an application, or of all its rules (rule null). */
export interface ActiveMute {
  id: string;
  appId: string;
  rule: string | null;
  until: Date;
}

/** The silence that covers an alert of `rule` in `appId`, the one that lasts longest; null when none. */
export function coveringMute(
  mutes: readonly ActiveMute[],
  appId: string,
  rule: string,
): ActiveMute | null {
  let found: ActiveMute | null = null;
  for (const mute of mutes) {
    if (mute.appId !== appId || (mute.rule !== null && mute.rule !== rule)) continue;
    if (found === null || mute.until > found.until) found = mute;
  }
  return found;
}

const SELECT = {
  id: true,
  appId: true,
  rule: true,
  reason: true,
  until: true,
  createdById: true,
  createdAt: true,
  endedAt: true,
  endedById: true,
  app: { select: { slug: true } },
} satisfies Prisma.AlertMuteSelect;

// Silences of an application's alerts (alert_mutes), by the people who work
// on them (administrators, and the auditors assigned to the application),
// for at most a week: the alerts are raised, kept and shown as always; email,
// chat, escalation and the panel's sounds and browser notices stay quiet.
// Lifting one ends it at once. Each change is in Audit Hub's own log.
@Injectable()
export class AlertMutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AppAccessService,
  ) {}

  /** The silences in force now in these applications. */
  async active(
    appIds: readonly string[],
    db: Db = this.prisma,
    now = new Date(),
  ): Promise<ActiveMute[]> {
    if (appIds.length === 0) return [];
    return db.alertMute.findMany({
      where: { appId: { in: [...appIds] }, until: { gt: now }, endedAt: null },
      select: { id: true, appId: true, rule: true, until: true },
    });
  }

  /** The silences of the applications the caller may see: in force first, the most recent 100. */
  async list(user: RequestUser, appId?: string): Promise<AlertMuteResponse[]> {
    if (appId !== undefined && !(await this.access.canSee(user, appId))) return [];
    const visible = await this.access.appFilter(user);
    const rows = await this.prisma.alertMute.findMany({
      where: { ...visible, ...(appId === undefined ? {} : { appId }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: SELECT,
    });
    const now = new Date();
    return rows
      .map((row) => toResponse(row, now))
      .sort((a, b) => Number(b.active) - Number(a.active));
  }

  async create(user: RequestUser, input: CreateAlertMuteDto): Promise<AlertMuteResponse> {
    if (!(await this.access.canManage(user, input.appId))) {
      throw new NotFoundException('Application not found');
    }
    if (input.rule !== null && !RULES.has(input.rule)) {
      throw new BadRequestException('No such detection rule');
    }
    const now = new Date();
    const row = await this.prisma.alertMute.create({
      data: {
        appId: input.appId,
        rule: input.rule,
        reason: input.reason,
        until: new Date(now.getTime() + input.minutes * 60_000),
        createdById: user.id,
      },
      select: SELECT,
    });
    return toResponse(row, now);
  }

  async lift(user: RequestUser, id: string): Promise<AlertMuteResponse> {
    const row = await this.prisma.alertMute.findUnique({ where: { id }, select: SELECT });
    if (row === null || !(await this.access.canManage(user, row.appId))) {
      throw new NotFoundException('Silence not found');
    }
    const now = new Date();
    if (row.endedAt !== null || row.until <= now) {
      throw new ConflictException('This silence has already ended');
    }
    const ended = await this.prisma.alertMute.update({
      where: { id },
      data: { endedAt: now, endedById: user.id },
      select: SELECT,
    });
    return toResponse(ended, now);
  }
}

function toResponse(
  row: Prisma.AlertMuteGetPayload<{ select: typeof SELECT }>,
  now: Date,
): AlertMuteResponse {
  return {
    id: row.id,
    appId: row.appId,
    appSlug: row.app.slug,
    rule: row.rule,
    reason: row.reason,
    until: row.until.toISOString(),
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    endedById: row.endedById,
    active: row.endedAt === null && row.until > now,
  };
}
