/** The page's queue, in memory: at most this many events, the oldest dropped first. */
export const QUEUE_MAX = 20;

// The part of the SPA connector in the initial bundle: a buffer the app's
// code reports into (src/auth/return-path.ts, src/auth/session.ts) before
// the reporter (reporter.ts, a lazy chunk) is loaded, and whether or not it
// ever is: the API's capabilities decide (auditClientEvents).

/** One of the page's own events, as the app's code reports it. */
export interface Reported {
  /** An action the API's catalog gives to clients. */
  action: string;
  details?: Record<string, string>;
  /** Whose it is, when not the signed-in user's (an expired session's). */
  userRef?: string;
  /** Unix milliseconds. */
  at: number;
}

const waiting: Reported[] = [];
let sink: ((event: Reported) => void) | undefined;

/** Reports one of the page's own events: queued until the reporter takes it, and then sent. */
export function reportAudit(
  action: string,
  details?: Record<string, string>,
  userRef?: string,
): void {
  const event: Reported = {
    action,
    at: Date.now(),
    ...(details === undefined ? {} : { details }),
    ...(userRef === undefined ? {} : { userRef }),
  };
  if (sink !== undefined) sink(event);
  else if (waiting.push(event) > QUEUE_MAX) waiting.shift();
}

/** The reporter takes what was reported before it, and everything after. */
export function attachAuditSink(next: ((event: Reported) => void) | undefined): void {
  sink = next;
  if (next !== undefined) for (const event of waiting.splice(0)) next(event);
}
