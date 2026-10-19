import type { SuspiciousSignal } from 'audit-contract';
import { certainDistanceKm, type Place, travelSpeedKmh } from './geo.js';
import {
  DORMANT_DAYS,
  IMPOSSIBLE_SPEED_KMH,
  LOCATION_MISMATCH_KM,
  TRAVEL_MIN_SECONDS,
} from './rules.constants.js';

const DAY_MS = 86_400_000;

/** What is known about a successful sign-in and about the account before it. */
export interface SignInFacts {
  at: Date;
  /** This device was seen with the account before. */
  knownDevice: boolean;
  /** Some device was seen with the account before (a first sign-in is not suspicious). */
  hasDevices: boolean;
  country: string | null;
  knownCountry: boolean;
  hasCountries: boolean;
  /** Where the IP is (public addresses only). */
  ipPlace: Place | null;
  /** Where the device said it was (with consent). */
  devicePlace: Place | null;
  /** The account's last known place and when. */
  previous: (Place & { at: Date }) | null;
  hostingIp: boolean;
  /** The account's last activity before this event; null when none is known. */
  lastSeenAt: Date | null;
}

export interface SignInVerdict {
  signals: SuspiciousSignal[];
  /** Back after DORMANT_DAYS or more without activity. */
  dormant: boolean;
  /** Impossible travel: from the account's last place, accuracy radii taken off (rounded). */
  travel?: { distanceKm: number; minutes: number; speedKmh: number };
  /** A device far from its IP: how far, accuracy radii taken off (rounded). */
  mismatchKm?: number;
}

/** Pure: the rules applied to one sign-in (docs/security.md#detection-rules). */
export function signInSignals(facts: SignInFacts): SignInVerdict {
  const signals: SuspiciousSignal[] = [];
  if (facts.hasDevices && !facts.knownDevice) signals.push('new_device');
  if (facts.country !== null && facts.hasCountries && !facts.knownCountry) {
    signals.push('new_country');
  }
  const here = facts.ipPlace ?? facts.devicePlace;
  let travel: SignInVerdict['travel'];
  if (here !== null && facts.previous !== null) {
    const speed = travelSpeedKmh(facts.previous, { ...here, at: facts.at }, TRAVEL_MIN_SECONDS);
    if (speed !== undefined && speed > IMPOSSIBLE_SPEED_KMH) {
      signals.push('impossible_travel');
      travel = {
        distanceKm: Math.round(certainDistanceKm(facts.previous, here)),
        minutes: Math.round(Math.abs(facts.at.getTime() - facts.previous.at.getTime()) / 60_000),
        speedKmh: Math.round(speed),
      };
    }
  }
  if (facts.hostingIp) signals.push('hosting_ip');
  const mismatch =
    facts.ipPlace === null || facts.devicePlace === null
      ? 0
      : certainDistanceKm(facts.ipPlace, facts.devicePlace);
  if (mismatch > LOCATION_MISMATCH_KM) signals.push('location_mismatch');
  const dormant =
    facts.lastSeenAt !== null &&
    facts.at.getTime() - facts.lastSeenAt.getTime() >= DORMANT_DAYS * DAY_MS;
  return {
    signals,
    dormant,
    ...(travel === undefined ? {} : { travel }),
    ...(mismatch > LOCATION_MISMATCH_KM ? { mismatchKm: Math.round(mismatch) } : {}),
  };
}

/** A suspicious sign-in's severity: high for travel or a new device from a new country. */
export function signInSeverity(signals: readonly SuspiciousSignal[]): 'medium' | 'high' {
  const has = (signal: SuspiciousSignal) => signals.includes(signal);
  return has('impossible_travel') || (has('new_device') && has('new_country')) ? 'high' : 'medium';
}
