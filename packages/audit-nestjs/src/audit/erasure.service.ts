import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AuditConfig } from './audit-env.js';
import { AUDIT_CONFIG } from './audit.constants.js';
import { recordHubRequest } from './audit.metrics.js';
import { AuditTransportError, type HubResponse } from './audit.ports.js';
import { type ErasureResult, ErasureResultSchema, type ErasureScope } from './contract/index.js';
import { envelopeData, HubClient } from './hub-client.js';

/**
 * The right to erasure in Audit Hub, for one of the project's users
 * (docs/audit/connection-guide.md, "A user's data"): `personal` deletes the
 * personal data of their events, which stay pseudonymous until their
 * retention; `events`, once the project cancelled the person's data, deletes
 * their events too. Either blocks them in Audit Hub: their events are never
 * shown for them again. An account deletion recorded as
 * `account.user.deleted` asks for `personal` by itself.
 */
@Injectable()
export class AuditErasureService {
  constructor(
    @Inject(AUDIT_CONFIG) private readonly config: AuditConfig | null,
    private readonly hub: HubClient,
  ) {}

  /** What Audit Hub erased; null while the connector is off (nothing was sent to it). */
  async erase(subject: string, scope: ErasureScope = 'personal'): Promise<ErasureResult | null> {
    if (this.config === null) return null;
    let response: HubResponse;
    try {
      response = await this.hub.erase(subject, scope);
    } catch (error) {
      if (!(error instanceof AuditTransportError)) throw error;
      recordHubRequest('erasure', 'unreachable');
      throw new ServiceUnavailableException('Audit Hub cannot be reached: ask again later');
    }
    const result = ErasureResultSchema.safeParse(envelopeData(response));
    if (response.status !== 200 || !result.success) {
      recordHubRequest('erasure', response.status === 200 ? 'failed' : 'refused');
      throw new ServiceUnavailableException('Audit Hub did not erase the user: ask again later');
    }
    recordHubRequest('erasure', 'ok');
    return result.data;
  }
}
