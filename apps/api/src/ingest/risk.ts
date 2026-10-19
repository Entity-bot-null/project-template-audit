import type { AuditEvent } from 'audit-contract';
import type { IpScope } from '../enrichment/ip.js';

// The ingest-time risk score (0–100): what is known when the event arrives.
// Rules that need history (a new device, impossible travel) raise alerts
// instead; the stored event never changes (docs/adr/0007).

const SEVERITY_WEIGHT: Record<string, number> = {
  info: 0,
  low: 10,
  medium: 30,
  high: 60,
  critical: 80,
};

export interface RiskInputs {
  severity: string;
  outcome: AuditEvent['outcome'];
  ipScope: IpScope | null;
  clientDeclared: readonly string[];
  /** Extra signals from enrichment (hosting IP, …), each worth its points. */
  signals?: readonly number[];
}

export function riskScore(input: RiskInputs): number {
  let score = SEVERITY_WEIGHT[input.severity] ?? 0;
  if (input.outcome === 'failure') score += 10;
  if (input.outcome === 'denied') score += 15;
  // What the application's server did not see itself weighs a little more.
  if (input.clientDeclared.length > 0) score += 5;
  for (const points of input.signals ?? []) score += points;
  return Math.max(0, Math.min(100, score));
}
