import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { AuditEvent } from 'audit-contract';
import type { Enrichment } from '../ingest/event-rows.js';
import { observeGeoIp } from '../observability/metrics.js';
import { GEOIP_READER, HOSTING_ASNS } from './enrichment.constants.js';
import type { GeoIpReader } from './geoip.js';
import { canonicalIp, ipScope } from './ip.js';
import { parseUserAgent } from './user-agent.js';

/** Risk points of an address in a hosting or VPN network (risk.ts adds them). */
export const HOSTING_RISK_POINTS = 20;

// What Audit Hub adds to an event at ingest (docs/adr/0011): the place and
// network of a public IP, when a database is loaded, and the family of the
// user agent. Pure lookups in memory: nothing leaves the process.
@Injectable()
export class EnrichmentService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Enrichment');

  constructor(
    @Inject(GEOIP_READER) private readonly geoip: GeoIpReader,
    @Inject(HOSTING_ASNS) private readonly hostingAsns: ReadonlySet<number>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.geoip.enabled) return;
    observeGeoIp(() => this.geoip.ageDays());
    const age = this.geoip.ageDays() ?? 0;
    this.logger.log(
      `IP geolocation on: database built ${String(Math.floor(age))} days ago${this.hostingAsns.size > 0 ? `, ${String(this.hostingAsns.size)} hosting ASNs` : ''}`,
    );
  }

  /** Whether the place of an IP can be known (the rules that need it say so when not). */
  get geolocation(): boolean {
    return this.geoip.enabled;
  }

  enrich(event: Pick<AuditEvent, 'network'>): Enrichment {
    const enrichment: Enrichment = { ...parseUserAgent(event.network?.userAgent) };
    const ip = event.network?.ip === undefined ? undefined : canonicalIp(event.network.ip);
    if (ip === undefined || !this.geoip.enabled || ipScope(ip) !== 'public') return enrichment;
    const place = this.geoip.lookup(ip);
    if (place.country !== undefined) enrichment.geoCountry = place.country;
    if (place.asn !== undefined) enrichment.geoAsn = place.asn;
    if (place.subdivision !== undefined) enrichment.geoSubdivision = place.subdivision;
    if (place.city !== undefined) enrichment.geoCity = place.city;
    if (place.latitude !== undefined && place.longitude !== undefined) {
      enrichment.geoLatitude = place.latitude;
      enrichment.geoLongitude = place.longitude;
      if (place.accuracyKm !== undefined) enrichment.geoAccuracyKm = place.accuracyKm;
    }
    if (place.asn !== undefined && this.hostingAsns.has(place.asn)) {
      enrichment.riskSignals = [HOSTING_RISK_POINTS];
    }
    return enrichment;
  }

  /** Whether an ASN is in the operator's hosting list. */
  isHosting(asn: number | null | undefined): boolean {
    return asn !== null && asn !== undefined && this.hostingAsns.has(asn);
  }
}
