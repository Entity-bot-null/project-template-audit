import { Global, Module } from '@nestjs/common';
import { env } from '../env/env.js';
import { GEOIP_READER, HOSTING_ASNS } from './enrichment.constants.js';
import { EnrichmentService } from './enrichment.service.js';
import { geoIpReaderFromFiles, hostingAsnsFromFile } from './geoip.js';

// Enrichment at ingest, and for the rules (docs/adr/0011). The files are read
// once at boot: an operator replaces them and restarts.
@Global()
@Module({
  providers: [
    {
      provide: GEOIP_READER,
      useFactory: () =>
        geoIpReaderFromFiles({ city: env.GEOIP_CITY_DB_PATH, asn: env.GEOIP_ASN_DB_PATH }),
    },
    { provide: HOSTING_ASNS, useFactory: () => hostingAsnsFromFile(env.GEOIP_HOSTING_ASNS_PATH) },
    EnrichmentService,
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
