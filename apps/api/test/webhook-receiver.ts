import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseSignatureHeader } from 'audit-contract';
import { bodyDigest, secretKey, verifySignature } from 'audit-contract/node';

// An application's webhook route, as the suites need one: a local HTTP server
// that records every delivery, checks its signature with the application's
// webhook secret, and answers what the spec asks for.

export interface ReceivedWebhook {
  headers: IncomingHttpHeaders;
  body: { id: string; type: string; data: Record<string, unknown> };
  path: string;
}

export interface WebhookReceiver {
  /** The URL to register as the application's webhook URL. */
  url: string;
  received: ReceivedWebhook[];
  /** The status and body of the next answers (default 200 accepted). */
  answer: (status: number, body?: unknown) => void;
  /** Whether a delivery is signed with this secret (AUDIT_HUB_WEBHOOK_SECRET). */
  verify: (delivery: ReceivedWebhook, secret: string, slug: string) => boolean;
  close: () => Promise<void>;
}

export async function startWebhookReceiver(path = '/api/audit/webhooks'): Promise<WebhookReceiver> {
  const received: ReceivedWebhook[] = [];
  let reply: { status: number; body: unknown } = {
    status: 200,
    body: { data: { status: 'accepted' } },
  };
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as ReceivedWebhook['body'],
        path: request.url ?? '',
      });
      response.writeHead(reply.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}${path}`,
    received,
    answer: (status, body = { data: { status: 'accepted' } }) => {
      reply = { status, body };
    },
    verify: (delivery, secret, slug) => {
      const digest = String(delivery.headers['audit-body-digest'] ?? '');
      if (digest !== bodyDigest(delivery.body)) return false;
      return verifySignature(
        [secretKey(secret)],
        {
          method: 'POST',
          path: delivery.path,
          query: '',
          timestamp: Number(delivery.headers['audit-timestamp']),
          nonce: String(delivery.headers['audit-webhook-id'] ?? ''),
          keyId: slug,
          bodyDigest: digest,
        },
        parseSignatureHeader(String(delivery.headers['audit-signature'] ?? '')),
      );
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
