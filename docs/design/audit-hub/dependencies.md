# New dependencies

Status: **proposal, waiting for approval**. I checked every version on 2026-10-14 against the
registry with these criteria:

- sha512 integrity;
- a license from `scripts/dependency-policy.json`;
- published more than 7 days ago (`minimumReleaseAge`);
- provenance or a trusted publisher, where it exists (`trustPolicy: no-downgrade` compares a new
  version with the strongest evidence of earlier ones).

None of these packages has an install script, so `allowBuilds` doesn't change.

## Audit Hub API (`apps/api`, production)

| Package    | Version (published) | License | Runtime dependencies                           | Publishing        | Why                                                                                                                                                                                                                                                                                      | Phase |
| ---------- | ------------------- | ------- | ---------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `otpauth`  | 9.5.2 (2026-09-03)  | MIT     | `@noble/hashes` 2.4.0 (MIT, trusted publisher) | trusted publisher | TOTP (RFC 6238) for the mandatory MFA ([ADR 0012](../../adr/0012-require-totp-and-recent-authentication.md)). Two packages in total, against nine for `otplib` 13.                                                                                                                       | F5    |
| `uqr`      | 0.1.3 (2026-04-03)  | MIT     | none                                           | none              | The QR matrix of the `otpauth://` URI. The SPA draws it as SVG `<rect>`s, so the CSP doesn't change.                                                                                                                                                                                     | F5    |
| `bowser`   | 2.14.1 (2026-02-08) | MIT     | none                                           | trusted publisher | User-agent family, OS and device class for the "new device" rule and the explorer. Mature, and already inside the AWS SDK's tree.                                                                                                                                                        | F4    |
| `mmdb-lib` | 3.0.3 (2026-07-30)  | MIT     | none                                           | trusted publisher | Reads the `.mmdb` file for IP geolocation, an **optional** integration that is off by default ([ADR 0011](../../adr/0011-geolocate-ips-with-an-optional-local-database.md)). `maxmind` 5.0.7 would add `tiny-lru` (BSD-3-Clause) and a file watcher that a read-only mount doesn't need. | F4    |

Checks still to do:

- **`uqr`:** confirm in F5 that `encode()` returns the module matrix. I only confirmed that
  `renderSVG` exists. If `encode()` doesn't, the alternative is `qrcode` 1.5.4, which brings 29
  packages including `yargs` and has had no release since 2024.
- **`bowser`:** to cut the ReDoS risk, user agents are truncated to 512 characters before parsing.
  If the review prefers no dependency, the alternative is our own small analyzer (browser
  family, OS family, device class) written with bounded regular expressions.

Optional and later. For archiving to S3-compatible storage, I propose deciding when it is built.
My recommendation is `aws4fetch` 1.0.20 (MIT, no dependencies). It would only sign the requests,
which still go through `createExternalHttpClient` (its injectable `fetch`), so archiving doesn't
need `@aws-sdk/client-s3` (26 packages, about 8 MB). That client would only be worth it if
multipart uploads are needed.

## What doesn't need a new dependency

| Need                                     | How                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON Schema of the contract              | `z.toJSONSchema()` from the installed Zod 4.6.5 (target `draft-2020-12`)                                                                                       |
| Validating events and catalogs           | Zod (the API already uses it); catalog field specs are compiled to Zod                                                                                         |
| UUIDv7                                   | `packages/audit-contract/src/uuidv7.ts` (RFC 9562, injected random source). `uuid` 14 is ESM-only, which `jest-expo` in the app wouldn't transform.            |
| HMAC, SHA-256, AES-256-GCM, random bytes | `node:crypto` (API); `expo-crypto` (app); Web Crypto (SPA)                                                                                                     |
| Canonical JSON for hashes                | Our own implementation of RFC 8785 for the JSON types we store, tested against the RFC's vectors                                                               |
| CSV and JSON Lines streaming             | Node streams                                                                                                                                                   |
| Charts                                   | Our own SVG components ([ADR 0014](../../adr/0014-build-the-admin-pages-lazily-with-own-svg-charts.md))                                                        |
| Locale and time zone on the device       | `Intl.DateTimeFormat().resolvedOptions()` (Hermes has Intl). This avoids `expo-localization`, a native module, but it must be checked in F8 on both platforms. |
| Network type on the device               | `expo-network`, already installed and wired to `onlineManager`                                                                                                 |

## Connector packages (`packages/*` of Audit Hub)

| Package          | Runtime dependencies                                                                                                                                                                            | Notes                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `audit-contract` | peer `zod` ^4.6 (already in the API 4.6.5 and the app 4.6.5)                                                                                                                                    | the SPA connector imports only its types                           |
| `audit-nestjs`   | peers `@nestjs/common`, `@nestjs/core`, `zod`, `@opentelemetry/api` (all already in project-template-web)                                                                                       | nothing new for a connected project                                |
| `audit-expo`     | peers `expo-sqlite`, `expo-device`, `expo-application`, `expo-updates`, `expo-network` (already installed), `expo-crypto` (**new**), `react`, `@tanstack/react-query`; optional `expo-location` | see below                                                          |
| `audit-web`      | none                                                                                                                                                                                            | ≤ 0.6 kB gzip, a lazy chunk inside the template's existing budgets |

## Expo app (project-template-app, through the connector)

| Package         | Version for SDK 57             | License | Dependencies                            | Why                                                                                                                                                                | Needs a store build                                               |
| --------------- | ------------------------------ | ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `expo-crypto`   | ~57.0.3 (57.0.3: 2026-09-11)   | MIT     | none                                    | A cryptographic source for `eventId` and for `X-Request-Id`, which today uses `Math.random` (`src/api/http.ts:171-180`). React Native 0.86 has no global `crypto`. | **yes** (native module; the fingerprint `runtimeVersion` changes) |
| `expo-location` | ~57.0.20 (57.0.20: 2026-09-24) | MIT     | `@expo/image-utils` (already installed) | **Optional**: location when a session starts, only with consent and only in the foreground; precise or approximate, the person's choice in the system dialog.      | **yes**, and only for apps that turn it on                        |

`expo-location` config, verified against the 57 docs and the package code:

- The library declares `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION`, and
  `requestForegroundPermissionsAsync()` asks for both on Android: Android 12+ shows the person
  "Precise" and "Approximate". The guide adds `android.permission.ACCESS_BACKGROUND_LOCATION` to
  `android.blockedPermissions` (until 2026-10-19 it blocked `ACCESS_FINE_LOCATION` too, for an
  approximate-only design).
- iOS 14+ shows a "Precise" switch in its dialog. The guide sets
  `ios.infoPlist.NSLocationDefaultAccuracyReduced: false` and the plugin's options
  `locationAlwaysAndWhenInUsePermission: false`, `locationAlwaysPermission: false` and
  `motionUsagePermission: false`.
- At run time the app reads `android.accuracy` (`fine`) / `ios.accuracy` (`full`) when a session
  starts: precise, one fresh fix (`getCurrentPositionAsync`, 10 seconds at most) the connector keeps
  to five decimals; approximate, the last known position, rounded to 0.01°.
- Checked on an emulator in F9: the approximate-only dialog. To check on a device before a release
  (the app's TESTING.md): the dialog with both choices, and a sign-in with each.

## Ruled out

| Package                                                | Why                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `ua-parser-js` 2.x                                     | AGPL-3.0-or-later: not allowed                                               |
| `@ua-parser-js/pro-*`                                  | commercial license                                                           |
| `ua-parser-js` 1.x                                     | legacy line with no provenance; a future 1.x release would hit `trustPolicy` |
| `otplib` 12                                            | deprecated; `thirty-two` has no license field                                |
| `qrcode`                                               | 29 packages (CLI dependencies at run time), no release since 2024            |
| `ajv`, `json-schema-to-typescript`                     | Zod is the source of the contract; no second validator                       |
| `uuid`                                                 | ESM-only (breaks the app's Jest setup); UUIDv7 is 30 lines                   |
| `@react-native-community/netinfo`, `expo-localization` | `expo-network` and `Intl` cover the need without a new native module         |

## Data, not npm

The IP geolocation database (a `.mmdb` file) is not a dependency. It is data with its own license,
and [ADR 0011](../../adr/0011-geolocate-ips-with-an-optional-local-database.md) covers it. The recommended database's terms are verified: DB-IP Lite is CC BY 4.0, MMDB, monthly, and requires a
link back to DB-IP.com wherever its results are shown. GeoLite2 and IPinfo Lite were not re-read.
