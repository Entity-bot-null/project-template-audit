import { describe, expect, it } from 'vitest';
import { ACTIVE_WITHIN_MS, type SourceFacts, sourceStatus } from './source-health.js';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const facts = (overrides: Partial<SourceFacts> = {}): SourceFacts => ({
  now: NOW,
  lastHeartbeatAt: ago(30_000),
  heartbeatTimeoutSec: 300,
  queueOldestAgeSec: null,
  backlogSec: 900,
  lastEventAt: ago(60_000),
  ...overrides,
});

describe('sourceStatus', () => {
  it('tells a source that never reported from one that stopped', () => {
    expect(sourceStatus(facts({ lastHeartbeatAt: null, lastEventAt: null }))).toBe('never');
    expect(sourceStatus(facts({ lastHeartbeatAt: null }))).toBe('never');
    expect(sourceStatus(facts({ lastHeartbeatAt: ago(301_000) }))).toBe('disconnected');
    // Its own timeout: an application that beats every 15 minutes is not late at 10.
    expect(sourceStatus(facts({ lastHeartbeatAt: ago(600_000), heartbeatTimeoutSec: 1200 }))).toBe(
      'active',
    );
  });

  it('tells a delayed source (its queue waits) from an idle one (no events, heartbeats on time)', () => {
    expect(sourceStatus(facts({ queueOldestAgeSec: 901 }))).toBe('delayed');
    expect(sourceStatus(facts({ queueOldestAgeSec: 900 }))).toBe('active');
    expect(sourceStatus(facts({ lastEventAt: ago(ACTIVE_WITHIN_MS + 1) }))).toBe('idle');
    expect(sourceStatus(facts({ lastEventAt: null }))).toBe('idle');
    // Silence with heartbeats is idle, never a loss: a loss shows in the sequence.
    expect(sourceStatus(facts({ lastEventAt: ago(30 * 86_400_000) }))).toBe('idle');
  });

  it('says disconnected before delayed: a stale queue says nothing', () => {
    expect(sourceStatus(facts({ lastHeartbeatAt: ago(400_000), queueOldestAgeSec: 5000 }))).toBe(
      'disconnected',
    );
  });
});
