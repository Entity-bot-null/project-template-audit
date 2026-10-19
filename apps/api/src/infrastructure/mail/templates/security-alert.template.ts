import { z } from 'zod';
import { renderMail } from './layout.js';
import type { MailTemplate } from './registry.js';

/** What the message is about: queued with the alert (alerts/alerts.service.ts). */
export const SecurityAlertPayloadSchema = z.object({ alertId: z.uuid() });

// Audit Hub: a new security alert, to the administrators and to the auditors
// assigned to its application (docs/adr/0013). Ids and the rule only: the
// admin pages show the rest to whoever may see it. Checked again when it is
// sent: a person who lost access to the application gets nothing.
export const securityAlertTemplate: MailTemplate = {
  limited: false,
  ttlMs: 24 * 60 * 60_000,
  async compose({ tx, message, product, appOrigin }) {
    const payload = SecurityAlertPayloadSchema.safeParse(message.payload);
    if (!payload.success || message.userId === null) return null;
    const alert = await tx.alert.findUnique({
      where: { id: payload.data.alertId },
      select: {
        id: true,
        rule: true,
        severity: true,
        title: true,
        appId: true,
        app: { select: { name: true, slug: true } },
      },
    });
    const user = await tx.user.findUnique({
      where: { id: message.userId },
      select: { role: true },
    });
    if (alert === null || user === null) return null;
    if (user.role !== 'admin') {
      const assigned = await tx.userAppAssignment.findUnique({
        where: { userId_appId: { userId: message.userId, appId: alert.appId } },
        select: { appId: true },
      });
      if (user.role !== 'auditor' || assigned === null) return null;
    }
    const severity = alert.severity.toUpperCase();
    return renderMail(
      {
        subject: `[${severity}] Security alert in ${alert.app.name}: ${alert.title}`,
        heading: `Security alert: ${alert.title}`,
        paragraphs: [
          `${product} raised a ${alert.severity} alert for ${alert.app.name} (${alert.app.slug}).`,
          `Rule: ${alert.rule}.`,
        ],
        action: { label: 'Open the alert', url: `${appOrigin}/alerts/${alert.id}` },
        footer: [
          'You receive this as an administrator of Audit Hub, or an auditor of this application.',
          'The details are in Audit Hub only: this message carries no personal data.',
        ],
      },
      product,
    );
  },
};
