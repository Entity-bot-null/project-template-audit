// The state of an application's event source, from what Audit Hub knows of it
// (docs/security.md#source-health): its connector's heartbeats (and the queue
// they report) and the events it received. Pure: the health rules and the
// SOC view share it.
//
// - never: no heartbeat ever: the connector is not set up, or not yet.
// - disconnected: its last heartbeat is older than the application's
//   heartbeat timeout: the connector stopped, or cannot reach Audit Hub.
// - delayed: heartbeats arrive, and the oldest event they say is queued has
//   waited longer than the threshold: delayed, not lost.
// - active: heartbeats arrive, and events did within the last hour.
// - idle: heartbeats arrive, no events lately: nothing happened, or nothing
//   that is audited. Never taken for a loss: a loss shows in the sequence
//   numbers (coverage_gap), not in silence.

export const SOURCE_STATUSES = ['never', 'disconnected', 'delayed', 'idle', 'active'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Events within this make a source active; heartbeats without them, idle. */
export const ACTIVE_WITHIN_MS = 60 * 60_000;

export interface SourceFacts {
  now: Date;
  lastHeartbeatAt: Date | null;
  heartbeatTimeoutSec: number;
  /** The oldest queued event among the instances heard from within the timeout; null: none. */
  queueOldestAgeSec: number | null;
  /** The delay past which queued events count as delayed. */
  backlogSec: number;
  lastEventAt: Date | null;
}

export function sourceStatus(facts: SourceFacts): SourceStatus {
  if (facts.lastHeartbeatAt === null) return 'never';
  const now = facts.now.getTime();
  if (now - facts.lastHeartbeatAt.getTime() > facts.heartbeatTimeoutSec * 1000) {
    return 'disconnected';
  }
  if (facts.queueOldestAgeSec !== null && facts.queueOldestAgeSec > facts.backlogSec)
    return 'delayed';
  if (facts.lastEventAt !== null && now - facts.lastEventAt.getTime() <= ACTIVE_WITHIN_MS) {
    return 'active';
  }
  return 'idle';
}
