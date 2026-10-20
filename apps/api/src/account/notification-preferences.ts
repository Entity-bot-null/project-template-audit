import { Body, Controller, Get, Injectable, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors, ZodBody } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;

/** A set of severities: each once. */
const Severities = z
  .array(z.enum(SEVERITIES))
  .max(SEVERITIES.length)
  .transform((values) => [...new Set(values)]);

/**
 * How the panel tells a person about alerts, in their browser: sounds and
 * the browser's own notices, by severity, and quiet times. Kept per account
 * (notification_preferences), the same on every device; whether the browser
 * allows sound or notices stays the browser's.
 */
export const NotificationPreferencesSchema = z.object({
  sound: z.object({
    enabled: z.boolean(),
    /** 0 to 100. */
    volume: z.int().min(0).max(100),
    severities: Severities,
  }),
  browser: z.object({
    enabled: z.boolean(),
    severities: Severities,
  }),
  /** The critical sound again while the alert stays unacknowledged: every so often, a few times at most. */
  criticalRepeat: z.object({
    enabled: z.boolean(),
    intervalSeconds: z.int().min(30).max(600),
    times: z.int().min(1).max(10),
  }),
  /** Quiet (no sound, no notice) until then; null: not now. At most a week ahead. */
  quietUntil: z.iso.datetime().nullable(),
  /** Applications whose alerts never sound nor notify here (they still show in the lists). */
  mutedAppIds: z.array(z.uuid()).max(100),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  sound: { enabled: true, volume: 60, severities: ['critical', 'high'] },
  browser: { enabled: false, severities: ['critical', 'high'] },
  criticalRepeat: { enabled: true, intervalSeconds: 60, times: 3 },
  quietUntil: null,
  mutedAppIds: [],
};

const WEEK_MS = 7 * 86_400_000;

// Each person's notification preferences: read and written by that person
// only (their own account), validated, kept as one document.
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    const stored = NotificationPreferencesSchema.safeParse(row?.preferences);
    return stored.success ? stored.data : DEFAULT_NOTIFICATION_PREFERENCES;
  }

  async put(userId: string, input: NotificationPreferences): Promise<NotificationPreferences> {
    const quietUntil =
      input.quietUntil === null
        ? null
        : new Date(Math.min(Date.parse(input.quietUntil), Date.now() + WEEK_MS)).toISOString();
    const preferences = { ...input, quietUntil };
    const json = preferences as unknown as Prisma.InputJsonObject;
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, preferences: json },
      update: { preferences: json },
    });
    return preferences;
  }
}

@ApiTags('account')
@Controller('account/notification-preferences')
@Auth()
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Your notification preferences: sounds, browser notices, quiet times' })
  @ApiData(NotificationPreferencesSchema)
  @ApiErrors(401)
  get(@CurrentUser() user: RequestUser) {
    return this.preferences.get(user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Change your notification preferences' })
  @ZodBody(NotificationPreferencesSchema)
  @ApiData(NotificationPreferencesSchema)
  @ApiErrors(400, 401)
  put(@CurrentUser() user: RequestUser, @Body() body: NotificationPreferences) {
    return this.preferences.put(user.id, body);
  }
}
