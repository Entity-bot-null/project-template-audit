import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AuditConfig } from './audit-env.js';
import { AuditTransportError, type HubResponse } from './audit.ports.js';
import { FakeTransport, ok, TEST_CONFIG } from './audit.testing.js';
import type { ErasureResult } from './contract/index.js';
import { AuditErasureService } from './erasure.service.js';
import { HubClient } from './hub-client.js';

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const ERASED: ErasureResult = { personalDeleted: 4, locationDeleted: 1, held: 0 };

function setup(respond: () => HubResponse, config: AuditConfig | null = TEST_CONFIG) {
  const transport = new FakeTransport(respond);
  const service = new AuditErasureService(config, new HubClient(config, transport, () => NOW));
  return { transport, service };
}

describe('AuditErasureService', () => {
  it('sends nothing while the connector is off', async () => {
    const { transport, service } = setup(() => ok(ERASED), null);
    await expect(service.erase('user-1')).resolves.toBeNull();
    expect(transport.requests).toEqual([]);
  });

  it("asks Audit Hub to erase the user's personal data, or their events too", async () => {
    const events = { ...ERASED, eventsDeleted: 7, eventsPending: 2 };
    let answer: ErasureResult = ERASED;
    const { transport, service } = setup(() => ok(answer));

    await expect(service.erase('user-1')).resolves.toEqual(ERASED);
    answer = events;
    await expect(service.erase('a:b', 'events')).resolves.toEqual(events);

    expect(
      transport.requests.map((request) => [request.method, request.path, request.body]),
    ).toEqual([
      ['POST', '/api/connector/subjects/user-1/erasure', { scope: 'personal' }],
      ['POST', '/api/connector/subjects/a%3Ab/erasure', { scope: 'events' }],
    ]);
  });

  it.each([
    ['a result that is not one', ok({ personalDeleted: 'all' })],
    ['no envelope', { status: 200, body: null }],
    ['a refusal', { status: 401, body: { message: 'Invalid signature' } }],
    ['a failure with a result', { status: 500, body: { data: ERASED } }],
  ])('answers 503 for %s', async (_case, response) => {
    const { service } = setup(() => response);
    await expect(service.erase('user-1')).rejects.toThrow(
      new ServiceUnavailableException('Audit Hub did not erase the user: ask again later'),
    );
  });

  it('answers 503 while Audit Hub is unreachable, and lets any other failure through', async () => {
    const unreachable = setup(() => {
      throw new AuditTransportError('timeout');
    });
    await expect(unreachable.service.erase('user-1')).rejects.toThrow(
      new ServiceUnavailableException('Audit Hub cannot be reached: ask again later'),
    );
    const failure = new Error('connection pool closed');
    const broken = setup(() => {
      throw failure;
    });
    await expect(broken.service.erase('user-1')).rejects.toBe(failure);
  });
});
