# Data model

Status: **proposal, waiting for approval**. The models follow docs/database.md:

- `PascalCase` models, `camelCase` fields, `snake_case` through `@map`/`@@map`;
- `uuid(7)` keys (checked: Prisma 7.10 validates `@default(uuid(7))` and generates the value in
  the client);
- `Timestamptz(3)`;
- an explicit `onDelete`;
- CHECK constraints, partial indexes, triggers, functions and grants as raw SQL in the migration,
  with a comment in the schema.

The migrations are split per phase (F1 to F5), each one small, as docs/database.md asks.

## 1. Audit Hub (`apps/api/prisma/schema.prisma`)

### Changes to the template's models

```prisma
// Least to most privileged (docs/how-to.md#add-a-role). `member` keeps the
// template's meaning, an account that can sign in, and in Audit Hub it sees no
// application data until an admin makes it a viewer or an auditor. Every role
// needs a second factor (ADR 0012). Keep in sync with ROLES in
// src/common/types/request-user.ts.
enum Role {
  member
  viewer
  auditor
  admin
}

model User {
  // … template fields (role keeps @default(member)) …

  appAssignments UserAppAssignment[]
  mfaFactor      MfaFactor?
  recoveryCodes  MfaRecoveryCode[]
  mfaChallenges  MfaChallenge[]
}

model Session {
  // … template fields …
  // When the family started with a second factor: refreshed access tokens keep
  // their `mfa` claim from here, so admin/auditor tokens never lose it.
  mfaVerifiedAt DateTime? @map("mfa_verified_at") @db.Timestamptz(3)
}

enum MailKind {
  // … template kinds …
  // An alert for the auditors and admins assigned to its application (ids only).
  security_alert
  // A second factor was added, reset or used with a recovery code (security notice).
  mfa_changed
}
```

Adding `viewer` and `auditor` follows the template's recipe for a role. It is an expand step
(`ALTER TYPE "Role" ADD VALUE`), so no contract step and no rewritten migration are needed.

### Connected applications, keys and catalogs

```prisma
enum ConnectedAppStatus {
  active
  // Ingestion answers 403; queries and the panel keep working.
  suspended
}

enum ResponseActionType {
  revoke_sessions
  require_password_change
  disable_account
}

// An application that sends events. One row per deployment environment
// (my-project-prod, my-project-staging): their data never mixes.
// CHECK in the migration: slug format, timeouts and limits in range.
model ConnectedApp {
  id                       String               @id @default(uuid(7)) @db.Uuid
  // Short id for metrics (label connected_app), URLs and the webhook signature.
  slug                     String               @unique
  name                     String
  environment              String
  status                   ConnectedAppStatus   @default(active)
  // The row that holds Audit Hub's own events (audit_access, its sign-ins).
  system                   Boolean              @default(false)
  webhookUrl               String?              @map("webhook_url")
  // AES-256-GCM ciphertexts (common/crypto/secret-box.ts, AUDIT_SECRETS_KEY).
  webhookSecret            Bytes?               @map("webhook_secret")
  // The previous secret keeps signing (second signature) until this time.
  webhookSecretPrevious    Bytes?               @map("webhook_secret_previous")
  webhookPreviousUntil     DateTime?            @map("webhook_previous_until") @db.Timestamptz(3)
  // HMAC key for emails and session references, shared with the app once.
  pseudonymKey             Bytes                @map("pseudonym_key")
  correlationEnabled       Boolean              @default(false) @map("correlation_enabled")
  acceptedResponseActions  ResponseActionType[] @default([]) @map("accepted_response_actions")
  requireActionApproval    Boolean              @default(true) @map("require_action_approval")
  heartbeatTimeoutSec      Int                  @default(300) @map("heartbeat_timeout_sec")
  rateLimitPerMinute       Int                  @default(120) @map("rate_limit_per_minute")
  createdById              String?              @map("created_by_id") @db.Uuid
  createdAt                DateTime             @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt                DateTime             @updatedAt @map("updated_at") @db.Timestamptz(3)

  keys        AppKey[]
  catalogs    CatalogVersion[]
  events      AuditEvent[]
  assignments UserAppAssignment[]

  @@map("connected_apps")
}

// A signing key of an application. The id is public (Audit-Key-Id); the secret
// is shown once at creation, then only its ciphertext exists. At most two keys
// are valid at a time (service, under an advisory lock): the current one and
// the one it replaced, until expiresAt.
model AppKey {
  id          String    @id @default(uuid(7)) @db.Uuid
  appId       String    @map("app_id") @db.Uuid
  secret      Bytes
  // Fingerprint of the AUDIT_SECRETS_KEY that encrypted it (rotation).
  encKeyId    String    @map("enc_key_id")
  expiresAt   DateTime? @map("expires_at") @db.Timestamptz(3)
  revokedAt   DateTime? @map("revoked_at") @db.Timestamptz(3)
  // Written at most once a minute per key.
  lastUsedAt  DateTime? @map("last_used_at") @db.Timestamptz(3)
  createdById String?   @map("created_by_id") @db.Uuid
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  app ConnectedApp @relation(fields: [appId], references: [id], onDelete: Restrict)

  @@index([appId])
  @@map("app_keys")
}

// A published catalog. Immutable (append-only trigger): an event always points
// to the exact version it was validated against.
model CatalogVersion {
  id          String   @id @default(uuid(7)) @db.Uuid
  appId       String   @map("app_id") @db.Uuid
  // First 16 hex of SHA-256 over the canonical document.
  version     String
  appVersion  String   @map("app_version")
  document    Json
  publishedAt DateTime @default(now()) @map("published_at") @db.Timestamptz(3)
  keyId       String   @map("key_id") @db.Uuid

  app     ConnectedApp    @relation(fields: [appId], references: [id], onDelete: Restrict)
  actions CatalogAction[]
  events  AuditEvent[]

  @@unique([appId, version])
  @@map("catalog_versions")
}

// One action of a catalog version, normalized for validation and filters.
model CatalogAction {
  id               String        @id @default(uuid(7)) @db.Uuid
  catalogVersionId String        @map("catalog_version_id") @db.Uuid
  appId            String        @map("app_id") @db.Uuid
  action           String
  category         AuditCategory
  severity         AuditSeverity
  // server | client | both
  source           String
  tags             String[]
  userVisible      Boolean       @map("user_visible")
  description      String
  // The compiled spec (details and change fields, personal/sensitive marks).
  spec             Json

  catalogVersion CatalogVersion @relation(fields: [catalogVersionId], references: [id], onDelete: Restrict)

  @@unique([catalogVersionId, action])
  @@index([appId, action])
  @@map("catalog_actions")
}
```

### Ingestion bookkeeping

```prisma
// A nonce seen with a valid signature: a replay inside the window is refused.
// Swept once past expiresAt (window + skew).
model IngestNonce {
  keyId     String   @map("key_id") @db.Uuid
  nonce     String
  expiresAt DateTime @map("expires_at") @db.Timestamptz(3)

  @@id([keyId, nonce])
  @@index([expiresAt])
  @@map("ingest_nonces")
}

// Per application and sequence epoch: how far the sequence is complete.
model SequenceState {
  appId             String    @map("app_id") @db.Uuid
  epoch             String    @db.Uuid
  contiguousThrough BigInt    @default(0) @map("contiguous_through")
  maxSeen           BigInt    @default(0) @map("max_seen")
  startedAt         DateTime  @default(now()) @map("started_at") @db.Timestamptz(3)
  // A new epoch (restore, reset) must be acknowledged by an admin.
  acknowledgedAt    DateTime? @map("acknowledged_at") @db.Timestamptz(3)
  acknowledgedById  String?   @map("acknowledged_by_id") @db.Uuid
  updatedAt         DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@id([appId, epoch])
  @@map("sequence_states")
}

// Missing source_seq numbers older than the grace period.
model SequenceGap {
  id               String    @id @default(uuid(7)) @db.Uuid
  appId            String    @map("app_id") @db.Uuid
  epoch            String    @db.Uuid
  fromSeq          BigInt    @map("from_seq")
  toSeq            BigInt    @map("to_seq")
  detectedAt       DateTime  @default(now()) @map("detected_at") @db.Timestamptz(3)
  // arrived (late events filled it) | acknowledged (an admin accepted the loss)
  closedReason     String?   @map("closed_reason")
  closedAt         DateTime? @map("closed_at") @db.Timestamptz(3)
  closedById       String?   @map("closed_by_id") @db.Uuid

  @@index([appId, closedAt])
  @@map("sequence_gaps")
}

enum IngestExceptionKind {
  rejected
  // Same eventId sent again with a new sourceSeq (a device re-sent it).
  duplicate
}

// Every event that did not become a row of audit_events, so its sequence
// number is accounted for. Never the raw payload (it failed validation and may
// hold anything): the reason, the paths and the size. Append-only, 90 days.
model IngestException {
  id               String              @id @default(uuid(7)) @db.Uuid
  appId            String              @map("app_id") @db.Uuid
  epoch            String?             @db.Uuid
  sourceSeq        BigInt?             @map("source_seq")
  eventId          String?             @map("event_id")
  kind             IngestExceptionKind
  reason           String
  errorPaths       String[]            @map("error_paths")
  payloadBytes     Int                 @map("payload_bytes")
  connectorVersion String              @map("connector_version")
  receivedAt       DateTime            @default(now()) @map("received_at") @db.Timestamptz(3)

  @@index([appId, epoch, sourceSeq])
  @@index([receivedAt])
  @@map("ingest_exceptions")
}

// Latest heartbeat of each connector process. Swept after a day of silence.
model ConnectorInstance {
  appId              String   @map("app_id") @db.Uuid
  instanceId         String   @map("instance_id") @db.Uuid
  connectorName      String   @map("connector_name")
  connectorVersion   String   @map("connector_version")
  contractVersion    Int      @map("contract_version")
  appVersion         String   @map("app_version")
  catalogVersion     String   @map("catalog_version")
  queueSize          Int      @map("queue_size")
  queueOldestAgeSec  Int      @map("queue_oldest_age_sec")
  queueRetrying      Int      @map("queue_retrying")
  discardedAtSignOut Int      @map("discarded_at_sign_out")
  lastHeartbeatAt    DateTime @map("last_heartbeat_at") @db.Timestamptz(3)

  @@id([appId, instanceId])
  @@index([lastHeartbeatAt])
  @@map("connector_instances")
}
```

### Events and their satellite tables

```prisma
enum AuditCategory {
  security
  audit
  access
  system
  // Use of Audit Hub itself (searches, details, exports): never from an app.
  audit_access
}

enum AuditOutcome {
  success
  failure
  denied
}

enum AuditSeverity {
  info
  low
  medium
  high
  critical
}

enum ActorType {
  user
  service
  system
  anonymous
}

enum ClientType {
  web
  ios
  android
  api
  job
}

// Computed from the IP without any database (RFC 1918, 6598, 4193, …).
enum IpScope {
  public
  private
  loopback
  link_local
  shared
  reserved
}

// One audit event. Append-only: no UPDATE, no DELETE except through the
// retention functions (migration: REVOKE + trigger + SECURITY DEFINER).
// recorded_at is set by the database. Personal data lives in event_personal
// and event_locations (shorter retention); the event keeps a salted digest of
// each, and contentHash covers everything stored here (contract:
// canonicalEventForHash). Partial indexes for the explorer are in SQL.
model AuditEvent {
  // Audit Hub's id: UUIDv7 minted at ingest, the explorer's cursor key.
  id                   String         @id @default(uuid(7)) @db.Uuid
  appId                String         @map("app_id") @db.Uuid
  eventId              String         @map("event_id") @db.Uuid
  sequenceEpoch        String?        @map("sequence_epoch") @db.Uuid
  sourceSeq            BigInt?        @map("source_seq")
  catalogVersionId     String?        @map("catalog_version_id") @db.Uuid
  schemaVersion        Int            @map("schema_version") @db.SmallInt
  connectorName        String         @map("connector_name")
  connectorVersion     String         @map("connector_version")
  occurredAt           DateTime       @map("occurred_at") @db.Timestamptz(3)
  recordedAt           DateTime       @default(now()) @map("recorded_at") @db.Timestamptz(3)
  category             AuditCategory
  action               String
  outcome              AuditOutcome
  severity             AuditSeverity
  // 0–100, computed at ingest (severity, outcome, IP scope, client-declared).
  riskScore            Int            @map("risk_score") @db.SmallInt
  reason               String?
  actorType            ActorType      @map("actor_type")
  actorId              String?        @map("actor_id")
  actorRole            String?        @map("actor_role")
  actorEmailHmac       String?        @map("actor_email_hmac")
  actorEmailHmacShared String?        @map("actor_email_hmac_shared")
  impersonatorId       String?        @map("impersonator_id")
  sessionRef           String?        @map("session_ref")
  resourceType         String?        @map("resource_type")
  resourceId           String?        @map("resource_id")
  parentResourceType   String?        @map("parent_resource_type")
  parentResourceId     String?        @map("parent_resource_id")
  changeBefore         Json?          @map("change_before")
  changeAfter          Json?          @map("change_after")
  changedFields        String[]       @map("changed_fields")
  requestId            String?        @map("request_id")
  traceId              String?        @map("trace_id")
  httpMethod           String?        @map("http_method")
  httpRoute            String?        @map("http_route")
  httpStatus           Int?           @map("http_status") @db.SmallInt
  durationMs           Int?           @map("duration_ms")
  clientType           ClientType?    @map("client_type")
  clientAppVersion     String?        @map("client_app_version")
  clientAppBuild       String?        @map("client_app_build")
  clientUpdateId       String?        @map("client_update_id") @db.Uuid
  clientOs             String?        @map("client_os")
  clientOsVersion      String?        @map("client_os_version")
  clientDeviceModel    String?        @map("client_device_model")
  clientLocale         String?        @map("client_locale")
  clientTimeZone       String?        @map("client_time_zone")
  clientNetworkType    String?        @map("client_network_type")
  clientRoute          String?        @map("client_route")
  // name@version of the client connector.
  clientSdk            String?        @map("client_sdk")
  clientDeclared       String[]       @map("client_declared")
  ipScope              IpScope?       @map("ip_scope")
  geoCountry           String?        @map("geo_country") @db.Char(2)
  geoAsn               Int?           @map("geo_asn")
  uaBrowser            String?        @map("ua_browser")
  uaOs                 String?        @map("ua_os")
  uaDeviceClass        String?        @map("ua_device_class")
  details              Json?
  truncatedFields      String[]       @map("truncated_fields")
  droppedFields        String[]       @map("dropped_fields")
  // occurred_at_adjusted, sensitive_unmasked, …
  flags                String[]
  // SHA-256(salt ‖ canonical satellite row); the salt is in that row.
  personalDigest       Bytes?         @map("personal_digest")
  locationDigest       Bytes?         @map("location_digest")
  contentHash          Bytes          @map("content_hash")

  app            ConnectedApp    @relation(fields: [appId], references: [id], onDelete: Restrict)
  catalogVersion CatalogVersion? @relation(fields: [catalogVersionId], references: [id], onDelete: Restrict)
  personal       EventPersonal?
  location       EventLocation?
  alertLinks     AlertEvent[]

  @@unique([appId, eventId])
  @@unique([appId, sequenceEpoch, sourceSeq])
  @@index([appId, recordedAt(sort: Desc), id(sort: Desc)])
  @@index([appId, category, recordedAt])
  @@index([appId, action, recordedAt(sort: Desc)])
  @@index([catalogVersionId])
  @@index([recordedAt])
  @@map("audit_events")
}

// Network and device data of an event: retention class `personal` (90 days by
// default) and the subject's right to erasure. Append-only like the event.
model EventPersonal {
  eventPk        String   @id @map("event_pk") @db.Uuid
  appId          String   @map("app_id") @db.Uuid
  recordedAt     DateTime @map("recorded_at") @db.Timestamptz(3)
  salt           Bytes
  ip             String?  @db.Inet
  userAgent      String?  @map("user_agent")
  deviceId       String?  @map("device_id")
  actorLabel     String?  @map("actor_label")
  resourceLabel  String?  @map("resource_label")
  geoSubdivision String?  @map("geo_subdivision")
  geoCity        String?  @map("geo_city")
  // City-level coordinates from the IP database, for impossible travel.
  geoLatitude    Decimal? @map("geo_latitude") @db.Decimal(6, 3)
  geoLongitude   Decimal? @map("geo_longitude") @db.Decimal(6, 3)
  geoAccuracyKm  Int?     @map("geo_accuracy_km")
  // Values of the catalog's personal paths (change.name, details.x).
  personalChange Json?    @map("personal_change")
  // Added 2026-10-19 (migration record_phones_hints_and_precise_locations):
  // the actor's phone masked at the origin (•••• 1234), and the request's
  // client hints. In the row's digest only when present, so a row without
  // them hashes as before they existed.
  actorPhone     String?  @map("actor_phone")
  clientHints    Json?    @map("client_hints")

  event AuditEvent @relation(fields: [eventPk], references: [id], onDelete: Restrict)

  @@index([appId, ip, recordedAt])
  @@index([recordedAt])
  @@map("event_personal")
}

// Device coordinates (consent only): retention class `location` (30 days by
// default). Approximate ones have two decimals (0.01°); precise ones, only
// with consent to the precise position, five. coordinateDecimals says which,
// and the verifier reads each row's digest at it (widened from DECIMAL(5,2)
// on 2026-10-19: every older row has two).
model EventLocation {
  eventPk            String   @id @map("event_pk") @db.Uuid
  appId              String   @map("app_id") @db.Uuid
  recordedAt         DateTime @map("recorded_at") @db.Timestamptz(3)
  salt               Bytes
  latitude           Decimal  @db.Decimal(7, 5)
  longitude          Decimal  @db.Decimal(8, 5)
  coordinateDecimals Int      @default(2) @map("coordinate_decimals") @db.SmallInt
  accuracyM          Int      @map("accuracy_m")
  capturedAt DateTime @map("captured_at") @db.Timestamptz(3)

  event AuditEvent @relation(fields: [eventPk], references: [id], onDelete: Restrict)

  @@index([recordedAt])
  @@map("event_locations")
}
```

### Integrity

```prisma
// One seal per stream (app, category) and time window [windowFrom, windowTo):
// every event recorded in the window, in (recorded_at, id) order, as leaves.
// sealHash chains the seals; signature = HMAC(AUDIT_INTEGRITY_KEY, sealHash).
// Append-only, never deleted (ADR 0008).
model IntegritySeal {
  id           String        @id @default(uuid(7)) @db.Uuid
  appId        String        @map("app_id") @db.Uuid
  category     AuditCategory
  // 1, 2, 3, … per stream (CHECK + unique).
  sealNo       BigInt        @map("seal_no")
  windowFrom   DateTime      @map("window_from") @db.Timestamptz(3)
  windowTo     DateTime      @map("window_to") @db.Timestamptz(3)
  eventCount   Int           @map("event_count")
  leavesDigest Bytes         @map("leaves_digest")
  prevHash     Bytes         @map("prev_hash")
  sealHash     Bytes         @map("seal_hash")
  keyId        String        @map("key_id")
  signature    Bytes
  createdAt    DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)

  leaves IntegritySealLeaves?

  @@unique([appId, category, sealNo])
  @@index([appId, category, windowTo])
  @@map("integrity_seals")
}

// The leaves of a seal: n × (16-byte event pk ‖ 32-byte content hash). Deleted
// by the retention function once every event of the seal is gone; the seal
// keeps their digest and count.
model IntegritySealLeaves {
  sealId String @id @map("seal_id") @db.Uuid
  leaves Bytes

  seal IntegritySeal @relation(fields: [sealId], references: [id], onDelete: Restrict)

  @@map("integrity_seal_leaves")
}

// Daily signed checkpoint over the head of every stream; exportable
// (audit export --checkpoint) to keep a copy outside Audit Hub.
model IntegrityCheckpoint {
  id        String   @id @default(uuid(7)) @db.Uuid
  heads     Json
  digest    Bytes
  keyId     String   @map("key_id")
  signature Bytes
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([createdAt])
  @@map("integrity_checkpoints")
}

// Every verification (job or CLI) and its outcome. Append-only.
model IntegrityVerification {
  id            String    @id @default(uuid(7)) @db.Uuid
  trigger       String
  scope         Json
  outcome       String
  eventsChecked BigInt    @map("events_checked")
  sealsChecked  Int       @map("seals_checked")
  failures      Int
  // The first failures: { kind, appId, category, sealNo, eventPk } (ids only).
  failureSample Json?     @map("failure_sample")
  startedAt     DateTime  @map("started_at") @db.Timestamptz(3)
  finishedAt    DateTime  @default(now()) @map("finished_at") @db.Timestamptz(3)

  @@index([finishedAt])
  @@map("integrity_verifications")
}
```

### Retention, legal holds and erasure

```prisma
enum RetentionClass {
  security
  audit
  access
  system
  audit_access
  // event_personal (network and device data)
  personal
  // event_locations (device coordinates)
  location
}

// Per application and class. CHECK in the migration: days >=
// audit_retention_min_days(class) (730/365/180/30/730/90/30) and <= 3650.
// No row: the minimum applies.
model RetentionPolicy {
  appId       String         @map("app_id") @db.Uuid
  class       RetentionClass
  days        Int
  updatedById String?        @map("updated_by_id") @db.Uuid
  createdAt   DateTime       @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime       @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@id([appId, class])
  @@map("retention_policies")
}

// Written by audit_purge() itself, in its own transaction. Append-only.
model RetentionRun {
  id           String         @id @default(uuid(7)) @db.Uuid
  appId        String         @map("app_id") @db.Uuid
  class        RetentionClass
  cutoff       DateTime       @db.Timestamptz(3)
  deletedCount Int            @map("deleted_count")
  heldCount    Int            @map("held_count")
  trigger      String
  startedAt    DateTime       @map("started_at") @db.Timestamptz(3)
  finishedAt   DateTime       @default(now()) @map("finished_at") @db.Timestamptz(3)

  seals RetentionRunSeal[]

  @@index([appId, class, finishedAt])
  @@map("retention_runs")
}

// How many events of each seal a run deleted: the verifier accounts for every
// missing leaf with these rows.
model RetentionRunSeal {
  runId        String @map("run_id") @db.Uuid
  sealId       String @map("seal_id") @db.Uuid
  deletedCount Int    @map("deleted_count")

  run RetentionRun @relation(fields: [runId], references: [id], onDelete: Restrict)

  @@id([runId, sealId])
  @@index([sealId])
  @@map("retention_run_seals")
}

// A legal hold suspends retention and erasure for what it matches (every
// non-null criterion must match). Released by a separate row, never edited.
model LegalHold {
  id             String    @id @default(uuid(7)) @db.Uuid
  appId          String    @map("app_id") @db.Uuid
  caseRef        String    @map("case_ref")
  reason         String
  actorId        String?   @map("actor_id")
  actorEmailHmac String?   @map("actor_email_hmac")
  resourceType   String?   @map("resource_type")
  resourceId     String?   @map("resource_id")
  fromAt         DateTime? @map("from_at") @db.Timestamptz(3)
  toAt           DateTime? @map("to_at") @db.Timestamptz(3)
  createdById    String    @map("created_by_id") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  release LegalHoldRelease?

  @@index([appId])
  @@map("legal_holds")
}

model LegalHoldRelease {
  holdId       String   @id @map("hold_id") @db.Uuid
  reason       String
  releasedById String   @map("released_by_id") @db.Uuid
  releasedAt   DateTime @default(now()) @map("released_at") @db.Timestamptz(3)

  hold LegalHold @relation(fields: [holdId], references: [id], onDelete: Restrict)

  @@map("legal_hold_releases")
}

// Written by audit_erase_subject(). Append-only.
model ErasureRun {
  id              String   @id @default(uuid(7)) @db.Uuid
  appId           String   @map("app_id") @db.Uuid
  subject         String
  personalDeleted Int      @map("personal_deleted")
  locationDeleted Int      @map("location_deleted")
  heldCount       Int      @map("held_count")
  requestedVia    String   @map("requested_via")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([appId, subject])
  @@map("erasure_runs")
}
```

### Rules, alerts, webhooks and response actions

```prisma
// What the real-time rules remember per subject. Personal: swept after 90
// days without activity, coordinates after 30 (retention job).
model ActorDevice {
  appId       String   @map("app_id") @db.Uuid
  actorId     String   @map("actor_id")
  // HMAC of the installation id, or of browser family + OS + device class.
  deviceKey   String   @map("device_key")
  firstSeenAt DateTime @map("first_seen_at") @db.Timestamptz(3)
  lastSeenAt  DateTime @map("last_seen_at") @db.Timestamptz(3)

  @@id([appId, actorId, deviceKey])
  @@index([lastSeenAt])
  @@map("actor_devices")
}

model ActorCountry {
  appId       String   @map("app_id") @db.Uuid
  actorId     String   @map("actor_id")
  country     String   @db.Char(2)
  firstSeenAt DateTime @map("first_seen_at") @db.Timestamptz(3)
  lastSeenAt  DateTime @map("last_seen_at") @db.Timestamptz(3)

  @@id([appId, actorId, country])
  @@index([lastSeenAt])
  @@map("actor_countries")
}

model ActorProfile {
  appId          String    @map("app_id") @db.Uuid
  actorId        String    @map("actor_id")
  lastSeenAt     DateTime  @map("last_seen_at") @db.Timestamptz(3)
  lastSignInAt   DateTime? @map("last_sign_in_at") @db.Timestamptz(3)
  lastLatitude   Decimal?  @map("last_latitude") @db.Decimal(6, 3)
  lastLongitude  Decimal?  @map("last_longitude") @db.Decimal(6, 3)
  lastAccuracyKm Int?      @map("last_accuracy_km")
  lastLocationAt DateTime? @map("last_location_at") @db.Timestamptz(3)

  @@id([appId, actorId])
  @@index([lastSeenAt])
  @@map("actor_profiles")
}

// Position of a cursor-driven job (real-time rules): last (recorded_at, id).
model RuleCursor {
  name       String   @id
  recordedAt DateTime @map("recorded_at") @db.Timestamptz(3)
  eventPk    String   @map("event_pk") @db.Uuid
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("rule_cursors")
}

enum AlertStatus {
  open
  in_review
  resolved
  false_positive
}

// An alert, grouped: a rule firing again for the same group key while the
// alert is open or in review adds an occurrence (partial unique index in SQL).
// summary holds ids, counts and countries, never emails or IPs.
model Alert {
  id           String        @id @default(uuid(7)) @db.Uuid
  appId        String        @map("app_id") @db.Uuid
  rule         String
  severity     AuditSeverity
  status       AlertStatus   @default(open)
  groupKey     String        @map("group_key")
  subject      String?
  title        String
  summary      Json
  occurrences  Int           @default(1)
  firstSeenAt  DateTime      @map("first_seen_at") @db.Timestamptz(3)
  lastSeenAt   DateTime      @map("last_seen_at") @db.Timestamptz(3)
  assigneeId   String?       @map("assignee_id") @db.Uuid
  resolvedAt   DateTime?     @map("resolved_at") @db.Timestamptz(3)
  resolvedById String?       @map("resolved_by_id") @db.Uuid
  // Optimistic concurrency for status/assignee changes.
  version      Int           @default(0)
  createdAt    DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)

  activities AlertActivity[]
  events     AlertEvent[]

  @@index([appId, status, lastSeenAt(sort: Desc)])
  @@index([assigneeId])
  @@map("alerts")
}

// History of an alert: created, occurrence, status, assignment, note,
// notified. Append-only.
model AlertActivity {
  id         String   @id @default(uuid(7)) @db.Uuid
  alertId    String   @map("alert_id") @db.Uuid
  kind       String
  userId     String?  @map("user_id") @db.Uuid
  fromStatus String?  @map("from_status")
  toStatus   String?  @map("to_status")
  note       String?
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  alert Alert @relation(fields: [alertId], references: [id], onDelete: Restrict)

  @@index([alertId, createdAt])
  @@map("alert_activities")
}

// The events behind an alert (the first 100).
model AlertEvent {
  alertId String @map("alert_id") @db.Uuid
  eventPk String @map("event_pk") @db.Uuid

  alert Alert      @relation(fields: [alertId], references: [id], onDelete: Restrict)
  event AuditEvent @relation(fields: [eventPk], references: [id], onDelete: Restrict)

  @@id([alertId, eventPk])
  @@index([eventPk])
  @@map("alert_events")
}

enum WebhookTarget {
  app
  slack
  teams
}

enum DeliveryStatus {
  pending
  sending
  delivered
  failed
  expired
}

// The webhook outbox, built like the mail outbox (ADR 0003): written in the
// transaction that calls for it, claimed with a lease (FOR UPDATE SKIP
// LOCKED), retried with backoff, signed when sent. id = Audit-Webhook-Id.
model WebhookDelivery {
  id            String         @id @default(uuid(7)) @db.Uuid
  appId         String?        @map("app_id") @db.Uuid
  target        WebhookTarget
  type          String
  payload       Json
  status        DeliveryStatus @default(pending)
  attempts      Int            @default(0)
  nextAttemptAt DateTime       @default(now()) @map("next_attempt_at") @db.Timestamptz(3)
  lockedUntil   DateTime?      @map("locked_until") @db.Timestamptz(3)
  // HTTP status or error category of the last attempt (never the body).
  lastStatus    Int?           @map("last_status")
  lastError     String?        @map("last_error")
  deliveredAt   DateTime?      @map("delivered_at") @db.Timestamptz(3)
  expiresAt     DateTime       @map("expires_at") @db.Timestamptz(3)
  createdAt     DateTime       @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime       @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@index([status, nextAttemptAt])
  @@index([appId, createdAt])
  @@index([createdAt])
  @@map("webhook_deliveries")
}

enum ResponseActionStatus {
  pending_approval
  dispatched
  succeeded
  failed
  refused
  unsupported
  expired
  cancelled
}

// A response action asked of an application. CHECK: approver ≠ requester,
// reason 10–500 characters.
model ResponseAction {
  id            String               @id @default(uuid(7)) @db.Uuid
  appId         String               @map("app_id") @db.Uuid
  subject       String
  action        ResponseActionType
  reason        String
  status        ResponseActionStatus
  alertId       String?              @map("alert_id") @db.Uuid
  requestedById String               @map("requested_by_id") @db.Uuid
  approvedById  String?              @map("approved_by_id") @db.Uuid
  approvedAt    DateTime?            @map("approved_at") @db.Timestamptz(3)
  deliveryId    String?              @map("delivery_id") @db.Uuid
  resultEventPk String?              @map("result_event_pk") @db.Uuid
  expiresAt     DateTime             @map("expires_at") @db.Timestamptz(3)
  completedAt   DateTime?            @map("completed_at") @db.Timestamptz(3)
  createdAt     DateTime             @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime             @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@index([appId, status])
  @@map("response_actions")
}
```

### Access, MFA and exports

```prisma
// Which applications an auditor or viewer may see. Admins see every app.
model UserAppAssignment {
  userId      String   @map("user_id") @db.Uuid
  appId       String   @map("app_id") @db.Uuid
  createdById String?  @map("created_by_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  app  ConnectedApp @relation(fields: [appId], references: [id], onDelete: Restrict)

  @@id([userId, appId])
  @@index([appId])
  @@map("user_app_assignments")
}

// A TOTP factor (RFC 6238, SHA-1, 6 digits, 30 s). The secret is encrypted;
// lastUsedStep refuses a code twice.
model MfaFactor {
  id           String    @id @default(uuid(7)) @db.Uuid
  userId       String    @unique @map("user_id") @db.Uuid
  secret       Bytes
  encKeyId     String    @map("enc_key_id")
  confirmedAt  DateTime? @map("confirmed_at") @db.Timestamptz(3)
  lastUsedStep BigInt?   @map("last_used_step")
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("mfa_factors")
}

// Ten single-use recovery codes; only HMAC(pepper, code).
model MfaRecoveryCode {
  id        String    @id @default(uuid(7)) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  codeHash  String    @unique @map("code_hash")
  usedAt    DateTime? @map("used_at") @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("mfa_recovery_codes")
}

// The step between the password and the second factor (verify or enroll):
// single use, 5 minutes, 5 attempts. Only the SHA-256 of its token is stored.
// It carries the account's security_version: a password change or an MFA
// reset meanwhile ends it.
model MfaChallenge {
  id              String    @id @default(uuid(7)) @db.Uuid
  userId          String    @map("user_id") @db.Uuid
  purpose         String
  tokenHash       String    @unique @map("token_hash")
  securityVersion Int       @default(0) @map("security_version")
  attempts        Int       @default(0)
  expiresAt       DateTime  @map("expires_at") @db.Timestamptz(3)
  usedAt          DateTime? @map("used_at") @db.Timestamptz(3)
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("mfa_challenges")
}

// An export: what was asked, how much it returned and the digest of what was
// sent (also in its audit_access event).
model ExportJob {
  id            String    @id @default(uuid(7)) @db.Uuid
  requestedById String    @map("requested_by_id") @db.Uuid
  filters       Json
  format        String
  rowCap        Int       @map("row_cap")
  // running | completed | truncated | failed
  status        String
  rowCount      Int?      @map("row_count")
  // sha-256, base64 (Content-Digest of the body that was streamed).
  digest        String?
  startedAt     DateTime  @default(now()) @map("started_at") @db.Timestamptz(3)
  finishedAt    DateTime? @map("finished_at") @db.Timestamptz(3)

  @@index([requestedById, startedAt])
  @@map("export_jobs")
}

// Every run of a scheduled job: the "job did not run" alerts read the last
// success from here. Swept after 90 days.
model JobRun {
  id         String    @id @default(uuid(7)) @db.Uuid
  job        String
  outcome    String
  detail     Json?
  startedAt  DateTime  @map("started_at") @db.Timestamptz(3)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(3)

  @@index([job, startedAt(sort: Desc)])
  @@map("job_runs")
}
```

## 2. SQL that Prisma does not express (Audit Hub)

These are excerpts. Each block goes in the migration of its phase.

```sql
-- ── Append-only (F3) ─────────────────────────────────────────────────────────
-- No UPDATE ever. DELETE only inside the retention/erasure functions: they run
-- as the table owner (SECURITY DEFINER) and set a transaction-local flag. The
-- runtime role is never the owner, so setting the flag itself achieves nothing.
-- TRUNCATE is not blocked (the integration suites empty the tables with it);
-- app_runtime has no TRUNCATE privilege anyway (roles.sql).
CREATE FUNCTION audit_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('audit.maintenance', true) = 'on'
     AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% on %.% refused: the table is append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
-- The same trigger on: event_personal, event_locations, catalog_versions,
-- catalog_actions, integrity_seals, integrity_seal_leaves, integrity_checkpoints,
-- integrity_verifications, retention_runs, retention_run_seals, legal_holds,
-- legal_hold_releases, erasure_runs, ingest_exceptions, alert_activities.

-- recorded_at belongs to the database. Every transaction that writes events
-- must carry transaction_timeout <= 15 s: then no ingest transaction can commit
-- more than 15 s after its recorded_at, and a window ending 2 minutes ago is
-- final (sealing, ADR 0008).
CREATE FUNCTION audit_events_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_timeout')::interval = interval '0'
     OR current_setting('transaction_timeout')::interval > interval '15 seconds' THEN
    RAISE EXCEPTION 'audit events need transaction_timeout between 1 ms and 15 s'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.recorded_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER audit_events_server_fields BEFORE INSERT ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_before_insert();

-- ── Formats and invariants (F1/F2) ──────────────────────────────────────────
ALTER TABLE "connected_apps" ADD CONSTRAINT "connected_apps_slug_check" CHECK ("slug" ~ '^[a-z][a-z0-9-]{1,30}$');
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_risk_check" CHECK ("risk_score" BETWEEN 0 AND 100);
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_status_check" CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599);
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_hash_check" CHECK (octet_length("content_hash") = 32);
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_hmac_check" CHECK (
  ("actor_email_hmac" IS NULL OR "actor_email_hmac" ~ '^[0-9a-f]{64}$')
  AND ("session_ref" IS NULL OR "session_ref" ~ '^[0-9a-f]{64}$'));
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_check" CHECK (
  ("actor_type" = 'user') <= ("actor_id" IS NOT NULL));
-- Events from applications have a sequence; Audit Hub's own do not.
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_seq_check" CHECK (
  ("source_seq" IS NULL) = ("sequence_epoch" IS NULL) AND ("source_seq" IS NULL OR "source_seq" >= 1));
ALTER TABLE "integrity_seals" ADD CONSTRAINT "integrity_seals_window_check" CHECK ("window_from" < "window_to" AND "seal_no" >= 1 AND "event_count" >= 1);
ALTER TABLE "response_actions" ADD CONSTRAINT "response_actions_approver_check" CHECK ("approved_by_id" IS NULL OR "approved_by_id" <> "requested_by_id");
ALTER TABLE "response_actions" ADD CONSTRAINT "response_actions_reason_check" CHECK (char_length("reason") BETWEEN 10 AND 500);

-- Explorer and dashboards: partial indexes on optional columns.
CREATE INDEX "audit_events_actor_idx"    ON "audit_events" ("app_id", "actor_id", "recorded_at" DESC) WHERE "actor_id" IS NOT NULL;
CREATE INDEX "audit_events_email_idx"    ON "audit_events" ("app_id", "actor_email_hmac", "recorded_at" DESC) WHERE "actor_email_hmac" IS NOT NULL;
CREATE INDEX "audit_events_resource_idx" ON "audit_events" ("app_id", "resource_type", "resource_id", "recorded_at" DESC) WHERE "resource_id" IS NOT NULL;
CREATE INDEX "audit_events_request_idx"  ON "audit_events" ("app_id", "request_id") WHERE "request_id" IS NOT NULL;
CREATE INDEX "audit_events_failures_idx" ON "audit_events" ("app_id", "recorded_at" DESC) WHERE "outcome" <> 'success';
-- One open alert per group key.
CREATE UNIQUE INDEX "alerts_open_group_key" ON "alerts" ("group_key") WHERE "status" IN ('open', 'in_review');

-- ── Retention (F3) ──────────────────────────────────────────────────────────
CREATE FUNCTION audit_retention_min_days(c "RetentionClass") RETURNS integer
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE c WHEN 'security' THEN 730 WHEN 'audit' THEN 365 WHEN 'access' THEN 180
                WHEN 'system' THEN 30 WHEN 'audit_access' THEN 730
                WHEN 'personal' THEN 90 WHEN 'location' THEN 30 END $$;
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_days_check"
  CHECK ("days" >= audit_retention_min_days("class") AND "days" <= 3650);

-- Deletes what a retention class allows for one application, never inside the
-- retention period (minimum or the app's longer policy), never an unsealed
-- event, never what a legal hold matches. Records itself. Runs as its owner
-- (the migration role), the only path to DELETE on these tables.
CREATE FUNCTION audit_purge(p_app uuid, p_class "RetentionClass", p_cutoff timestamptz,
                            p_trigger text DEFAULT 'job', p_limit integer DEFAULT 5000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_days   integer;
  v_floor  timestamptz;
  v_run    uuid := uuidv7();          -- PostgreSQL 18
  v_start  timestamptz := clock_timestamp();
  v_count  integer := 0;
  v_held   integer := 0;
BEGIN
  SELECT greatest(audit_retention_min_days(p_class), coalesce(max(days), 0)) INTO v_days
    FROM retention_policies WHERE app_id = p_app AND class = p_class;
  v_floor := now() - make_interval(days => v_days);
  IF p_cutoff > v_floor THEN
    RAISE EXCEPTION 'cutoff % is inside the retention of % for this application (at most %)',
      p_cutoff, p_class, v_floor USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- One purge per (app, class) at a time, whatever LockService did.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('audit-purge:' || p_app || ':' || p_class, 0)) THEN
    RETURN 0;
  END IF;
  PERFORM set_config('audit.maintenance', 'on', true);
  -- 1. pick victims: recorded_at < p_cutoff, inside a sealed window, not held
  --    (EXISTS over legal_holds without a release); count the held ones;
  -- 2. delete their event_locations and event_personal rows, then the events
  --    (personal/location classes delete only the satellite rows);
  -- 3. insert retention_run_seals per seal touched, delete integrity_seal_leaves
  --    of seals left without events, insert the retention_runs row.
  -- (full body in F3, with its integration specs)
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN v_count;
END $$;

-- Right to erasure: the subject's satellite rows, except what a hold matches.
CREATE FUNCTION audit_erase_subject(p_app uuid, p_subject text, p_via text)
RETURNS TABLE (personal_deleted integer, location_deleted integer, held integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ … $$;

-- Grants for the runtime role, in one place: the migration calls it, roles.sql
-- calls it after its blanket GRANT (which would otherwise give UPDATE/DELETE
-- back), and the integration setup calls it after creating app_runtime.
CREATE FUNCTION audit_apply_runtime_privileges(p_role name) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = p_role) THEN RETURN; END IF;
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_events, event_personal, event_locations,
    catalog_versions, catalog_actions, integrity_seals, integrity_seal_leaves, integrity_checkpoints,
    integrity_verifications, retention_runs, retention_run_seals, legal_holds, legal_hold_releases,
    erasure_runs, ingest_exceptions, alert_activities FROM %I', p_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION audit_purge(uuid, "RetentionClass", timestamptz, text, integer),
    audit_erase_subject(uuid, text, text) TO %I', p_role);
END $$;
REVOKE ALL ON FUNCTION audit_purge(uuid, "RetentionClass", timestamptz, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_erase_subject(uuid, text, text) FROM PUBLIC;
SELECT audit_apply_runtime_privileges('app_runtime');

-- ── Audit Hub's own application row (F2) ────────────────────────────────────
INSERT INTO "connected_apps" ("id", "slug", "name", "environment", "system", "pseudonym_key", "updated_at")
VALUES ('00000000-0000-7000-8000-000000000001', 'audit-hub', 'Audit Hub', 'self', true, '\x', now());
```

At boot, the API also checks
`has_table_privilege(current_user, 'audit_events', 'UPDATE' | 'DELETE')`:

- In production, an error at boot, the gauge `app_database_privileges_ok` at 0, and the critical
  alert `AuditHubDatabasePrivilegesTooBroad`. Readiness stays as the template defines it (the
  production-like stack and the end-to-end suite connect as the owner). This is how
  someone notices the API running as the owner, or `roles.sql` re-granted without the function.
- In development (owner role) it is a warning.

## 3. Application side (connector NestJS, added by the app with `pnpm db:migrate`)

```prisma
// Audit Hub connector (docs/audit/connection-guide.md): an event is written
// here in the transaction of the change it describes, and forwarded by the
// worker in src/audit; deleted once Audit Hub answered for it. Holds personal
// data (IP, user agent) only until then. CHECK constraints in the migration.
model AuditOutbox {
  id            String    @id @default(uuid(7)) @db.Uuid
  eventId       String    @unique @map("event_id") @db.Uuid
  // Null until the forwarder sequences the row, in commit order, gapless.
  sourceSeq     BigInt?   @unique @map("source_seq")
  payload       Json
  attempts      Int       @default(0)
  nextAttemptAt DateTime  @default(now()) @map("next_attempt_at") @db.Timestamptz(3)
  lockedUntil   DateTime? @map("locked_until") @db.Timestamptz(3)
  // Category of the last failure (network, http_503, rejected_retryable…).
  lastError     String?   @map("last_error")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@index([createdAt])
  @@map("audit_outbox")
}

// The sequence counter (a single row): incremented in the forwarder's
// transaction, so a rollback gives the numbers back. A new epoch starts when
// the row is created (or reset after a restore).
model AuditOutboxState {
  id        Int      @id @default(1)
  epoch     String   @db.Uuid
  lastSeq   BigInt   @default(0) @map("last_seq")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("audit_outbox_state")
}

// "Was it you?": one row per suspicious sign-in Audit Hub reported. The user
// answers on a screen; an answer is final.
model AuditSecurityPrompt {
  id         String    @id @default(uuid(7)) @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  webhookId  String    @unique @map("webhook_id") @db.Uuid
  hubEventId String    @map("hub_event_id") @db.Uuid
  signals    String[]
  // country, city, client type, device model (no IP).
  context    Json
  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(3)
  answer     String?
  answeredAt DateTime? @map("answered_at") @db.Timestamptz(3)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([expiresAt])
  @@map("audit_security_prompts")
}

// Webhook deliveries already handled (Audit-Webhook-Id), for one day.
model AuditWebhookReceipt {
  id         String   @id @db.Uuid
  type       String
  receivedAt DateTime @default(now()) @map("received_at") @db.Timestamptz(3)

  @@index([receivedAt])
  @@map("audit_webhook_receipts")
}

// Optional push for "Was it you?" (the template has no push sender): the app
// registers its Expo push token here, the connector's ExpoPushSender uses it.
// Deleted at sign-out and when Expo reports DeviceNotRegistered.
model AuditPushToken {
  id         String   @id @default(uuid(7)) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  token      String   @unique
  platform   String
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  lastSeenAt DateTime @default(now()) @map("last_seen_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("audit_push_tokens")
}
```

```sql
ALTER TABLE "audit_outbox_state" ADD CONSTRAINT "audit_outbox_state_single_row" CHECK ("id" = 1 AND "last_seq" >= 0);
ALTER TABLE "audit_outbox" ADD CONSTRAINT "audit_outbox_attempts_check" CHECK ("attempts" >= 0);
-- The forwarder sequences rows in commit order: unsequenced first, by id.
CREATE INDEX "audit_outbox_unsequenced_idx" ON "audit_outbox" ("id") WHERE "source_seq" IS NULL;
CREATE INDEX "audit_outbox_due_idx" ON "audit_outbox" ("next_attempt_at", "source_seq") WHERE "source_seq" IS NOT NULL;
ALTER TABLE "audit_security_prompts" ADD CONSTRAINT "audit_security_prompts_answer_check"
  CHECK (("answer" IS NULL) = ("answered_at" IS NULL) AND ("answer" IS NULL OR "answer" IN ('confirmed', 'not_me')));
```

### Template patch (F9, prepared locally, never pushed)

These fill the gaps that response actions and the brief's integration points need. Each one is an
expand step:

```prisma
model User {
  // … template fields …
  // Set by an admin or by Audit Hub's disable_account action; sign-in, refresh
  // and the access-token guard refuse the account while it is set
  // (security_version moves in the same transaction).
  disabledAt               DateTime? @map("disabled_at") @db.Timestamptz(3)
  // Set by require_password_change: sign-in answers 403 "Password change
  // required" and queues a password_reset email; a completed reset or change
  // clears it.
  passwordChangeRequiredAt DateTime? @map("password_change_required_at") @db.Timestamptz(3)
}
```

## Open points to verify in F1 (not verified yet)

- Whether `prisma migrate dev` leaves the SQL-only partial indexes and triggers alone or tries to
  drop them in the next migration. The template never had a partial index. If Prisma 7.10
  expresses partial indexes natively, use that instead.
- `uuidv7()` exists in PostgreSQL 18 (the template's image is `postgres:18-alpine`), but the
  managed database's version must be 18 too. Otherwise `gen_random_uuid()` replaces it in the
  functions.
- `transaction_timeout` exists from PostgreSQL 17. On 16 the trigger falls back to
  `idle_in_transaction_session_timeout` plus `statement_timeout`, which is a weaker guarantee and
  needs a larger horizon.
