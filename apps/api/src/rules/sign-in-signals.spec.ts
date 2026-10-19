import { describe, expect, it } from 'vitest';
import { certainDistanceKm, distanceKm, travelSpeedKmh } from './geo.js';
import { type SignInFacts, signInSeverity, signInSignals } from './sign-in-signals.js';

const MADRID = { latitude: 40.4168, longitude: -3.7038, accuracyKm: 10 };
const MEXICO_CITY = { latitude: 19.4326, longitude: -99.1332, accuracyKm: 10 };
const AT = new Date('2026-10-15T12:00:00.000Z');
const hoursBefore = (hours: number) => new Date(AT.getTime() - hours * 3_600_000);

const facts = (overrides: Partial<SignInFacts> = {}): SignInFacts => ({
  at: AT,
  knownDevice: true,
  hasDevices: true,
  country: 'ES',
  knownCountry: true,
  hasCountries: true,
  ipPlace: MADRID,
  devicePlace: null,
  previous: { ...MADRID, at: hoursBefore(1) },
  hostingIp: false,
  lastSeenAt: hoursBefore(1),
  ...overrides,
});

describe('geo', () => {
  it('measures great-circle distances, accuracy taken off', () => {
    expect(distanceKm(MADRID, MEXICO_CITY)).toBeCloseTo(9070, -2);
    expect(distanceKm(MADRID, MADRID)).toBe(0);
    expect(certainDistanceKm(MADRID, MEXICO_CITY)).toBeCloseTo(
      distanceKm(MADRID, MEXICO_CITY) - 20,
    );
    expect(certainDistanceKm(MADRID, { ...MADRID, latitude: 40.5 })).toBe(0);
  });

  it('answers no speed for events too close in time', () => {
    expect(travelSpeedKmh({ ...MADRID, at: AT }, { ...MEXICO_CITY, at: AT }, 60)).toBeUndefined();
    expect(
      travelSpeedKmh({ ...MADRID, at: hoursBefore(10) }, { ...MEXICO_CITY, at: AT }, 60),
    ).toBeCloseTo(905, -1);
  });
});

describe('signInSignals', () => {
  it('finds nothing in a usual sign-in, nor in the first one of an account', () => {
    expect(signInSignals(facts())).toEqual({ signals: [], dormant: false });
    expect(
      signInSignals(
        facts({
          knownDevice: false,
          hasDevices: false,
          knownCountry: false,
          hasCountries: false,
          previous: null,
          lastSeenAt: null,
        }),
      ),
    ).toEqual({ signals: [], dormant: false });
  });

  it('names a new device and a new country', () => {
    expect(signInSignals(facts({ knownDevice: false, knownCountry: false })).signals).toEqual([
      'new_device',
      'new_country',
    ]);
    expect(signInSignals(facts({ country: null, knownCountry: false })).signals).toEqual([]);
  });

  it('finds impossible travel, from the IP or else the device, never within a minute', () => {
    const travel = facts({ ipPlace: MEXICO_CITY, previous: { ...MADRID, at: hoursBefore(2) } });
    expect(signInSignals(travel).signals).toEqual(['impossible_travel']);
    // The figures an alert explains it with, accuracy radii taken off.
    const km = certainDistanceKm(MADRID, MEXICO_CITY);
    expect(signInSignals(travel).travel).toEqual({
      distanceKm: Math.round(km),
      minutes: 120,
      speedKmh: Math.round(km / 2),
    });
    const slow = facts({ ipPlace: MEXICO_CITY, previous: { ...MADRID, at: hoursBefore(12) } });
    expect(signInSignals(slow).signals).toEqual([]);
    const fromDevice = facts({
      ipPlace: null,
      devicePlace: MEXICO_CITY,
      previous: { ...MADRID, at: hoursBefore(2) },
    });
    expect(signInSignals(fromDevice).signals).toEqual(['impossible_travel']);
    const sameMinute = facts({
      ipPlace: MEXICO_CITY,
      previous: { ...MADRID, at: new Date(AT.getTime() - 30_000) },
    });
    expect(signInSignals(sameMinute).signals).toEqual([]);
    expect(signInSignals(facts({ ipPlace: null, devicePlace: null })).signals).toEqual([]);
  });

  it('names a hosting IP and a device far from its IP', () => {
    expect(signInSignals(facts({ hostingIp: true })).signals).toEqual(['hosting_ip']);
    expect(signInSignals(facts({ devicePlace: MEXICO_CITY }))).toEqual({
      signals: ['location_mismatch'],
      dormant: false,
      mismatchKm: Math.round(certainDistanceKm(MADRID, MEXICO_CITY)),
    });
    expect(signInSignals(facts({ devicePlace: MADRID }))).toEqual({ signals: [], dormant: false });
  });

  it('tells a dormant account back after 90 days', () => {
    expect(signInSignals(facts({ lastSeenAt: hoursBefore(90 * 24) })).dormant).toBe(true);
    expect(signInSignals(facts({ lastSeenAt: hoursBefore(89 * 24) })).dormant).toBe(false);
  });

  it('rates travel, and a new device from a new country, high', () => {
    expect(signInSeverity(['impossible_travel'])).toBe('high');
    expect(signInSeverity(['new_device', 'new_country'])).toBe('high');
    expect(signInSeverity(['new_device'])).toBe('medium');
    expect(signInSeverity(['hosting_ip', 'new_country'])).toBe('medium');
  });
});
