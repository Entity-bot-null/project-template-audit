import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AsnResponse, CityResponse, Reader } from 'mmdb-lib';
import { describe, expect, it } from 'vitest';
import {
  geoIpReaderFromFiles,
  hostingAsnsFromFile,
  MmdbGeoIpReader,
  NO_GEOIP,
  parseAsnList,
} from './geoip.js';

const BUILT = new Date('2026-09-01T00:00:00.000Z');

/** A reader that answers from a table, as mmdb-lib's Reader does from a file. */
function fakeReader<T>(table: Record<string, T>, built = BUILT): Reader<T & CityResponse> {
  return {
    get: (ip: string) => table[ip] ?? null,
    metadata: { buildEpoch: built },
  } as unknown as Reader<T & CityResponse>;
}

const MADRID: CityResponse = {
  country: { iso_code: 'ES', geoname_id: 1, names: { en: 'Spain' } },
  subdivisions: [{ iso_code: 'MD', geoname_id: 2, names: { en: 'Madrid' } }],
  city: { geoname_id: 3, names: { en: 'Madrid' } },
  location: {
    latitude: 40.4165,
    longitude: -3.7026,
    accuracy_radius: 20,
    time_zone: 'Europe/Madrid',
  },
};

describe('MmdbGeoIpReader', () => {
  it('answers the place and the network of an address', () => {
    const reader = new MmdbGeoIpReader(
      fakeReader({ '198.51.100.1': MADRID }),
      fakeReader<AsnResponse>(
        {
          '198.51.100.1': {
            autonomous_system_number: 64500,
            autonomous_system_organization: 'Example',
          },
        },
        new Date('2026-08-01T00:00:00.000Z'),
      ),
    );
    expect(reader.enabled).toBe(true);
    expect(reader.lookup('198.51.100.1')).toEqual({
      country: 'ES',
      subdivision: 'Madrid',
      city: 'Madrid',
      latitude: 40.4165,
      longitude: -3.7026,
      accuracyKm: 20,
      asn: 64500,
    });
    expect(reader.lookup('198.51.100.2')).toEqual({});
    // The oldest database counts.
    expect(reader.ageDays(new Date('2026-08-11T00:00:00.000Z'))).toBe(10);
  });

  it('keeps only well-formed values', () => {
    const odd = {
      country: { iso_code: 'xx' },
      location: { latitude: Number.NaN, longitude: 0 },
      traits: { autonomous_system_number: 64501 },
    } as unknown as CityResponse;
    const reader = new MmdbGeoIpReader(fakeReader({ '198.51.100.3': odd }), undefined);
    expect(reader.lookup('198.51.100.3')).toEqual({ asn: 64501 });
    const noAccuracy = {
      location: { latitude: 1, longitude: 2 },
    } as unknown as CityResponse;
    expect(new MmdbGeoIpReader(fakeReader({ a: noAccuracy }), undefined).lookup('a')).toEqual({
      latitude: 1,
      longitude: 2,
    });
  });

  it('is off without databases', () => {
    expect(new MmdbGeoIpReader(undefined, undefined).enabled).toBe(false);
    expect(new MmdbGeoIpReader(undefined, undefined).ageDays()).toBeUndefined();
    expect(NO_GEOIP.enabled).toBe(false);
    expect(NO_GEOIP.lookup('198.51.100.1')).toEqual({});
    expect(NO_GEOIP.ageDays()).toBeUndefined();
  });
});

describe('geoIpReaderFromFiles', () => {
  it('is off when no file is configured, and fails the boot for a file it cannot read', () => {
    expect(geoIpReaderFromFiles({})).toBe(NO_GEOIP);
    const dir = mkdtempSync(join(tmpdir(), 'geoip-'));
    const junk = join(dir, 'junk.mmdb');
    writeFileSync(junk, 'not a database');
    expect(() => geoIpReaderFromFiles({ city: junk })).toThrow(
      /GEOIP_CITY_DB_PATH .* not a readable/,
    );
    expect(() => geoIpReaderFromFiles({ asn: join(dir, 'missing.mmdb') })).toThrow(
      /GEOIP_ASN_DB_PATH/,
    );
  });
});

describe('hosting ASNs', () => {
  it('reads one ASN per line, with or without "AS", comments and blank lines allowed', () => {
    expect([...parseAsnList('AS64500\n# a comment\n\n64501 # trailing\r\nas64502\n')]).toEqual([
      64500, 64501, 64502,
    ]);
    expect(() => parseAsnList('AS0')).toThrow(/not an ASN/);
    expect(() => parseAsnList('hosting')).toThrow(/"hosting" is not an ASN/);
    expect(() => parseAsnList('99999999999')).toThrow(/not an ASN/);
  });

  it('is empty without a file, and fails the boot for a file it cannot read', () => {
    expect(hostingAsnsFromFile(undefined).size).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), 'asns-'));
    const file = join(dir, 'asns.txt');
    writeFileSync(file, 'AS64500\n');
    expect([...hostingAsnsFromFile(file)]).toEqual([64500]);
    expect(() => hostingAsnsFromFile(join(dir, 'missing.txt'))).toThrow(/not readable/);
  });
});
