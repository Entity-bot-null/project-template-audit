import { Injectable, NotFoundException } from '@nestjs/common';
import { MailOutboxService } from '../infrastructure/mail/mail-outbox.service.js';
import type { AuditSeverity, EscalationPolicy } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';
import { SEVERITY_VALUES } from './dto/alert.schemas.js';
import type {
  EscalationPolicyResponse,
  UpdateEscalationPolicyDto,
} from './dto/detection.schemas.js';

const RANK = Object.fromEntries(SEVERITY_VALUES.map((severity, index) => [severity, index]));

// The escalation policies (escalation_policies, one per severity, written by
// the migration): read by the escalation job on each pass, tuned by
// administrators; and what the deployment can send through.
@Injectable()
export class EscalationPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailOutboxService,
    private readonly webhooks: WebhookOutboxService,
  ) {}

  async list() {
    const rows = await this.prisma.escalationPolicy.findMany();
    return {
      items: rows.map(toResponse).sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0)),
      available: { email: this.mail.enabled, chat: [...this.webhooks.chatTargets] },
    };
  }

  async update(
    userId: string,
    severity: AuditSeverity,
    input: UpdateEscalationPolicyDto,
  ): Promise<EscalationPolicyResponse> {
    const exists = await this.prisma.escalationPolicy.findUnique({ where: { severity } });
    if (exists === null) throw new NotFoundException('No policy for this severity');
    const row = await this.prisma.escalationPolicy.update({
      where: { severity },
      data: { ...input, updatedById: userId },
    });
    return toResponse(row);
  }
}

function toResponse(row: EscalationPolicy): EscalationPolicyResponse {
  return {
    severity: row.severity,
    enabled: row.enabled,
    firstAfterMinutes: row.firstAfterMinutes,
    repeatEveryMinutes: row.repeatEveryMinutes,
    maxEscalations: row.maxEscalations,
    channels: row.channels.filter(
      (channel): channel is 'email' | 'chat' => channel === 'email' || channel === 'chat',
    ),
    updatedById: row.updatedById,
    updatedAt: row.updatedAt.toISOString(),
  };
}
