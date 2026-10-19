// The messages of the optional chat notifications (docs/adr/0013): the
// application, the rule, the severity and a link to the alert, never an email
// or an IP (alert titles are built from ids and counts).

export interface ChatAlert {
  appSlug: string;
  appName: string;
  rule: string;
  severity: string;
  title: string;
  /** The alert in the admin pages; absent when APP_ORIGIN is not set. */
  url?: string;
}

/** Slack's control characters, escaped as its message formatting docs ask (&, <, >). */
const SLACK_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const slackText = (text: string) =>
  text.replace(/[&<>]/g, (character) => SLACK_ESCAPES[character] ?? character);

/** A Slack incoming webhook's body: plain text with Slack's link markup. */
export function slackMessage(alert: ChatAlert): { text: string } {
  const head = `[${alert.severity.toUpperCase()}] ${slackText(alert.appName)} (${alert.appSlug}): ${slackText(alert.title)}`;
  const rule = `Rule: ${alert.rule}`;
  const link = alert.url === undefined ? '' : `\n<${alert.url}|Open the alert in Audit Hub>`;
  return { text: `${head}\n${rule}${link}` };
}

/** A Teams workflow webhook's body: a message with one Adaptive Card. */
export function teamsMessage(alert: ChatAlert): Record<string, unknown> {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: `[${alert.severity.toUpperCase()}] ${alert.title}`,
              weight: 'Bolder',
              wrap: true,
            },
            {
              type: 'FactSet',
              facts: [
                { title: 'Application', value: `${alert.appName} (${alert.appSlug})` },
                { title: 'Rule', value: alert.rule },
              ],
            },
          ],
          ...(alert.url === undefined
            ? {}
            : { actions: [{ type: 'Action.OpenUrl', title: 'Open the alert', url: alert.url }] }),
        },
      },
    ],
  };
}
