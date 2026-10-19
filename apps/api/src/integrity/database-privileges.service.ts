import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { errorSummary } from '../common/logging/error-summary.js';
import { env } from '../env/env.js';
import { observeDatabasePrivileges } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type PrivilegesHealth = 'ok' | 'too_broad' | 'unknown';

/** The tables the API must never update or delete from (docs/adr/0007). */
export const APPEND_ONLY_TABLES = ['audit_events', 'event_personal', 'integrity_seals'] as const;

// The API's own role must not be able to change audit records: the trigger
// refuses it anyway, and the missing grant is the first wall. Running as the
// tables' owner (a copied development configuration), or after roles.sql gave
// UPDATE back without audit_apply_runtime_privileges(), shows here: an error
// in production and the gauge app_database_privileges_ok, which
// AuditHubDatabasePrivilegesTooBroad reads. Readiness is left alone: the
// template's health contract stays as it is, and the API still works.
@Injectable()
export class DatabasePrivilegesService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Integrity');
  private state: PrivilegesHealth = 'unknown';

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    observeDatabasePrivileges(() => (this.state === 'unknown' ? undefined : this.state === 'ok'));
    await this.check();
  }

  /** The last check's result; no I/O. */
  health(): PrivilegesHealth {
    return this.state;
  }

  async check(): Promise<PrivilegesHealth> {
    try {
      const rows = await this.prisma.$queryRaw<{ table: string; mutable: boolean }[]>`
        SELECT t AS "table",
               has_table_privilege(current_user, t, 'UPDATE') OR has_table_privilege(current_user, t, 'DELETE') AS "mutable"
        FROM unnest(${[...APPEND_ONLY_TABLES]}::text[]) AS t`;
      const mutable = rows.filter((row) => row.mutable).map((row) => row.table);
      this.state = mutable.length === 0 ? 'ok' : 'too_broad';
      if (mutable.length > 0) {
        const message = `The API's database role can update or delete ${mutable.join(', ')}: run it as app_runtime, and audit_apply_runtime_privileges('app_runtime') after any GRANT (docs/adr/0007).`;
        // Expected in development and tests, where the API connects as the owner.
        if (env.NODE_ENV === 'production') this.logger.error(message);
        else this.logger.log(`${message} (Expected outside production.)`);
      }
    } catch (error) {
      this.state = 'unknown';
      this.logger.warn(`Could not check the database privileges: ${errorSummary(error)}`);
    }
    return this.state;
  }
}
