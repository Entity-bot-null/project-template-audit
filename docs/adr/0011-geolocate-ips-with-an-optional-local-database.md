# 0011. Geolocate IPs with an optional local database, off by default

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Audit Hub maintainers

## Context

Several rules need to know where an IP is:

- new country for a user;
- impossible travel (above 900 km/h between two events);
- hosting or VPN IP;
- a large difference between the IP's location and the device's.

So do the security dashboard (top countries) and the "My account's security" screens. The
template's rules for an optional integration apply: it is off by default, it never stops the
boot, its degraded behavior is documented and tested, and the containers are `read_only`.

Sending users' IPs to an online lookup API would disclose personal data to another processor on
every event, so the lookup must be local.

## Options

1. **MaxMind GeoLite2** (City, ASN), the most used. Downloading needs an account and a license key,
   and the data comes under MaxMind's end-user license and CC BY-SA 4.0, as the brief states. That
   means attribution plus a share-alike question for derived data.
2. **IPinfo Lite**: country and ASN, under CC BY-SA 4.0 per the brief. It has **no city
   coordinates**, so impossible travel would only work at country-centroid level, which is too
   coarse.
3. **DB-IP Lite** (IP to City Lite, IP to ASN Lite), monthly, offered in `.mmdb` format, under CC
   BY 4.0 per the brief: attribution only, no share-alike.
4. **An online API** (ipinfo.io, ipapi, …). Always fresh and with VPN flags, but every IP goes to
   a third party, and every lookup depends on someone else's availability.

## Decision

A `GeoIpReader` interface in `apps/api/src/enrichment/`, with an `.mmdb` implementation on
`mmdb-lib` (MIT, no dependencies) and a null implementation.

- **Configuration** (all optional):
  - `GEOIP_CITY_DB_PATH` and `GEOIP_ASN_DB_PATH`. Unset means geolocation is off, and
    `ip_scope` is still computed without data (private, loopback, shared…).
  - A path that is set but unreadable fails the boot: asking for a feature without what it needs
    fails, as with `RATE_LIMIT_STORE=redis` without `REDIS_URL`.
  - The boot log (`IP geolocation on: database built N days ago`) and the gauge
    `app_geoip_database_age_days` say whether it is on. Readiness stays as the template defines
    it: geolocation is optional, and its absence is not a failure.
- **Recommended data:** DB-IP Lite City + ASN, for its attribution-only license and its city
  coordinates. Any `.mmdb` with the same fields works (GeoLite2 for those who accept its terms).
  The choice and the license go in the deployment's records.
- **Deployment:** the files are mounted read-only into the API container (a `volumes:` entry with
  `:ro` in `deploy/vps/compose.yaml`). An operator replaces them monthly, and a restart picks them
  up. A runbook step and `pnpm --filter api audit geoip` print the build date of the loaded files,
  and the gauge `app_geoip_database_age_days` feeds a warning above 45 days.
- **Attribution:** "IP Geolocation by DB-IP" with a link to https://db-ip.com, wherever a
  location derived from it is shown:
  - in the panel: explorer, event detail, the 360° view and the security screen;
  - in the connected applications' "My account's security" screens (web and Expo), whose
    country and city come from it. The connector's components carry the link, and the guide
    says so.

  docs/security.md records the source and the license.

- **What is stored:**
  - the country and the ASN in the event (`geo_country`, `geo_asn`; not personal on their own);
  - the subdivision, the city and the city coordinates with their accuracy radius in
    `event_personal` (90 days), because together with time they locate a person.
- **Hosting/VPN detection** is a rule input, not a promise. No permissive, verified dataset of
  hosting ranges was found. The rule reads an operator-provided list of ASNs
  (`GEOIP_HOSTING_ASNS_PATH`, one per line, read-only mount) and stays off without it.
- **Impossible travel** subtracts both accuracy radii from the distance before computing the
  speed, and ignores `private`/`shared` scopes and events less than 60 s apart, so city-level
  noise doesn't page anyone.

## Consequences

- Without the files, Audit Hub works. The country, travel and hosting rules simply don't run, and
  the panel says so on the security screen instead of showing empty charts as if nothing
  happened. An integration spec covers that.
- **DB-IP Lite's terms are verified (db-ip.com/db/lite.php, 2026-10-14):** CC BY 4.0, CSV and MMDB,
  updated monthly. A web application must link back to DB-IP.com on the pages that display or use
  its results. GeoLite2 and IPinfo Lite were not re-read: a project that picks one of them reads
  its current terms first, and records them in a superseding ADR.
- Monthly updates are manual (a download outside the container). Automating the download is
  possible later as a job on the host, never from the read-only API container.
- We would know this was wrong if the rules' false positives traced back to the database's
  accuracy. Then a commercial database behind the same interface is a configuration change, not a
  code change.
