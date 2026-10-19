import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AuditConfig } from './audit-env.js';
import { ActivityService } from './activity.service.js';
import { AuditTransportError, type HubResponse } from './audit.ports.js';
import { FakeTransport, ok, TEST_CONFIG } from './audit.testing.js';
import { type ActivityPage, nodeRandomFill, uuidv7 } from './contract/index.js';
import { HubClient } from './hub-client.js';

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const clock = () => NOW;

const PAGE: ActivityPage = {
  items: [
    {
      eventId: uuidv7(nodeRandomFill, NOW),
      action: 'auth.session.signed_in',
      description: 'A user signed in.',
      outcome: 'success',
      occurredAt: new Date(NOW - 60_000).toISOString(),
      client: { type: 'ios', deviceModel: 'iPhone 16' },
      location: { country: 'MX', city: 'Monterrey' },
    },
  ],
  nextCursor: 'cursor-2',
  attribution: 'IP Geolocation by DB-IP',
};

function setup(respond: () => HubResponse, config: AuditConfig | null = TEST_CONFIG) {
  const transport = new FakeTransport(respond);
  const service = new ActivityService(config, new HubClient(config, transport, clock));
  return { transport, service };
}

describe('ActivityService', () => {
  it('answers 404 while the connector is off', async () => {
    const { transport, service } = setup(() => ok(PAGE), null);

    await expect(service.activity('user-1', { limit: 20 })).rejects.toThrow(NotFoundException);
    expect(transport.requests).toEqual([]);
  });

  it("answers the user's page from Audit Hub", async () => {
    const { transport, service } = setup(() => ok(PAGE));

    await expect(service.activity('user-1', { cursor: 'cursor-1', limit: 20 })).resolves.toEqual(
      PAGE,
    );
    await service.activity('user-1', { limit: 5 });

    expect(
      transport.requests.map((request) => [request.method, request.path, request.query]),
    ).toEqual([
      ['GET', '/api/connector/subjects/user-1/activity', { cursor: 'cursor-1', limit: '20' }],
      ['GET', '/api/connector/subjects/user-1/activity', { limit: '5' }],
    ]);
  });

  it.each([
    ['a page that is not one', ok({ items: 'none' })],
    ['no envelope', { status: 200, body: null }],
    ['a refusal', { status: 401, body: { message: 'Invalid signature' } }],
    ['a failure with a page', { status: 500, body: { data: PAGE } }],
  ])('answers 503 for %s', async (_case, response) => {
    const { service } = setup(() => response);

    await expect(service.activity('user-1', { limit: 20 })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('answers 503 while Audit Hub is unreachable', async () => {
    const { service } = setup(() => {
      throw new AuditTransportError('timeout');
    });

    await expect(service.activity('user-1', { limit: 20 })).rejects.toThrow(
      new ServiceUnavailableException('The account activity is unavailable right now'),
    );
  });

  it('lets any other failure through', async () => {
    const failure = new Error('connection pool closed');
    const { service } = setup(() => {
      throw failure;
    });

    await expect(service.activity('user-1', { limit: 20 })).rejects.toBe(failure);
  });
});
