import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AuditConfig } from './audit-env.js';
import { AUDIT_CONFIG } from './audit.constants.js';
import { recordHubRequest } from './audit.metrics.js';
import { AuditTransportError, type HubResponse } from './audit.ports.js';
import { type ActivityPage, ActivityPageSchema } from './contract/index.js';
import { envelopeData, HubClient } from './hub-client.js';

/**
 * "My account's security" (GET /api/account/activity): the signed-in user's
 * own activity, asked of Audit Hub with the application's key and limited
 * to that user. Only the actions the catalog marks user-visible, without
 * IP addresses.
 */
@Injectable()
export class ActivityService {
  constructor(
    @Inject(AUDIT_CONFIG) private readonly config: AuditConfig | null,
    private readonly hub: HubClient,
  ) {}

  async activity(userId: string, query: { cursor?: string; limit: number }): Promise<ActivityPage> {
    if (this.config === null) throw new NotFoundException('Not found');
    let response: HubResponse;
    try {
      response = await this.hub.activity(userId, query);
    } catch (error) {
      if (!(error instanceof AuditTransportError)) throw error;
      recordHubRequest('activity', 'unreachable');
      throw new ServiceUnavailableException('The account activity is unavailable right now');
    }
    const page = ActivityPageSchema.safeParse(envelopeData(response));
    if (response.status !== 200 || !page.success) {
      recordHubRequest('activity', response.status === 200 ? 'failed' : 'refused');
      throw new ServiceUnavailableException('The account activity is unavailable right now');
    }
    recordHubRequest('activity', 'ok');
    return page.data;
  }
}
