import { readFileSync } from 'node:fs';
import { type AsnResponse, type CityResponse, Reader } from 'mmdb-lib';

// IP geolocation from local .mmdb files (docs/adr/0011): optional, off unless
// GEOIP_CITY_DB_PATH or GEOIP_ASN_DB_PATH is set. Users' IPs never leave Audit
// Hub for a lookup. The recommended data is DB-IP Lite (CC BY 4.0, attribution
// "IP Geolocation by DB-IP"); any .mmdb with the GeoLite2 fields works.

export interface GeoLookup {
  country?: string;
  asn?: number;
  subdivision?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  accuracyKm?: number;
}

export interface GeoIpReader {
  /** Whether any database is loaded (the country, travel and hosting rules need one). */
  readonly enabled: boolean;
  /** Only public addresses are looked up (the caller checks the scope). */
  lookup(ip: string): GeoLookup;
  /** Days since the oldest loaded database was built; undefined when none is. */
  ageDays(now?: Date): number | undefined;
}

const DAY_MS = 86_400_000;
const COUNTRY = /^[A-Z]{2}$/;

/** Without databases: every lookup is empty. */
export const NO_GEOIP: GeoIpReader = {
  enabled: false,
  lookup: () => ({}),
  ageDays: () => undefined,
};

export class MmdbGeoIpReader implements GeoIpReader {
  readonly enabled: boolean;

  constructor(
    private readonly city: Reader<CityResponse> | undefined,
    private readonly asn: Reader<AsnResponse> | undefined,
  ) {
    this.enabled = city !== undefined || asn !== undefined;
  }

  lookup(ip: string): GeoLookup {
    const result: GeoLookup = {};
    const place = this.city?.get(ip) ?? null;
    if (place !== null) {
      const country = place.country?.iso_code;
      if (country !== undefined && COUNTRY.test(country)) result.country = country;
      const subdivision = place.subdivisions?.[0]?.names.en;
      if (subdivision !== undefined) result.subdivision = subdivision.slice(0, 128);
      const city = place.city?.names.en;
      if (city !== undefined) result.city = city.slice(0, 128);
      const location = place.location;
      if (location !== undefined && Number.isFinite(location.latitude)) {
        result.latitude = location.latitude;
        result.longitude = location.longitude;
        if (Number.isFinite(location.accuracy_radius)) result.accuracyKm = location.accuracy_radius;
      }
      // An ASN in the city database too (some sources carry it in traits).
      const traitsAsn = place.traits?.autonomous_system_number;
      if (traitsAsn !== undefined) result.asn = traitsAsn;
    }
    const network = this.asn?.get(ip) ?? null;
    if (network !== null && Number.isInteger(network.autonomous_system_number)) {
      result.asn = network.autonomous_system_number;
    }
    return result;
  }

  ageDays(now: Date = new Date()): number | undefined {
    const built = [this.city, this.asn]
      .filter((reader) => reader !== undefined)
      .map((reader) => reader.metadata.buildEpoch.getTime());
    if (built.length === 0) return undefined;
    return Math.max(0, (now.getTime() - Math.min(...built)) / DAY_MS);
  }
}

/**
 * The reader for the configured files. A path that is set but unreadable, or
 * not an .mmdb, fails the boot: asking for a feature without what it needs is
 * a configuration error (docs/adr/0011).
 */
export function geoIpReaderFromFiles(paths: { city?: string; asn?: string }): GeoIpReader {
  if (paths.city === undefined && paths.asn === undefined) return NO_GEOIP;
  const open = <T extends CityResponse | AsnResponse>(name: string, path: string | undefined) => {
    if (path === undefined) return undefined;
    try {
      return new Reader<T>(readFileSync(path));
    } catch (error) {
      throw new Error(`${name} (${path}) is not a readable .mmdb file`, { cause: error });
    }
  };
  return new MmdbGeoIpReader(
    open<CityResponse>('GEOIP_CITY_DB_PATH', paths.city),
    open<AsnResponse>('GEOIP_ASN_DB_PATH', paths.asn),
  );
}

/**
 * The hosting and VPN networks the operator lists (GEOIP_HOSTING_ASNS_PATH):
 * one ASN per line, "AS" prefix optional, "#" starts a comment. Unset: the
 * hosting rule stays off (no permissive dataset exists, docs/adr/0011).
 */
export function hostingAsnsFromFile(path: string | undefined): ReadonlySet<number> {
  if (path === undefined) return new Set();
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`GEOIP_HOSTING_ASNS_PATH (${path}) is not readable`, { cause: error });
  }
  return parseAsnList(text);
}

export function parseAsnList(text: string): ReadonlySet<number> {
  const asns = new Set<number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '') continue;
    const match = /^(?:AS)?(\d{1,10})$/i.exec(line);
    const asn = match === null ? Number.NaN : Number(match[1]);
    if (!Number.isSafeInteger(asn) || asn <= 0 || asn > 4_294_967_295) {
      throw new Error(`GEOIP_HOSTING_ASNS_PATH: "${line}" is not an ASN`);
    }
    asns.add(asn);
  }
  return asns;
}
