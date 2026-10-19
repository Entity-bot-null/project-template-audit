# Integration contract, version 1

Status: **proposal, waiting for approval**. It becomes `packages/audit-contract` in F1.

The contract is authored as Zod 4 schemas in `packages/audit-contract/src`. That is the validator
Audit Hub runs and the one the connectors' types come from. From it, `pnpm contract` generates the
files below with `z.toJSONSchema(…, { target: 'draft-2020-12' })` (it exists in the installed Zod
4.6.5). They are committed and drift-checked like `openapi/openapi.json`:

```
packages/audit-contract/schema/v1/event.schema.json          AuditEvent (application → hub)
packages/audit-contract/schema/v1/client-event.schema.json   ClientEvent (device → its backend)
packages/audit-contract/schema/v1/catalog.schema.json        CatalogDocument
packages/audit-contract/schema/v1/ingest.schema.json         batch, results, heartbeat
packages/audit-contract/schema/v1/webhook.schema.json        webhook envelope and payloads
openapi/openapi.json                                         Audit Hub's HTTP API (pnpm contract)
```

Choosing Zod over a hand-written JSON Schema is in [ADR 0005](../../adr/0005-define-the-integration-contract-and-idempotency.md).

## Wire conventions (and one conflict with the brief)

- **JSON field names are `camelCase`** (`eventId`, `sourceSeq`, `occurredAt`, …).
  docs/api-conventions.md requires it, and the brief writes them in `snake_case`. **The template
  rule wins**, so the database uses `snake_case` (`event_id`, …) and the wire uses `camelCase`.
  The field names in the brief map one to one.
- Timestamps are ISO 8601 UTC with milliseconds (`2026-10-14T12:00:00.000Z`).
- Every string has a maximum length. Ids and codes have closed patterns (no `@`, so an email
  can never pass as an id).
- Event ids are **UUIDv7**. The connectors generate them with
  `packages/audit-contract/src/uuidv7.ts`, an RFC 9562 implementation with an injected random
  source: `node:crypto` in NestJS, `expo-crypto` in the app, `crypto.getRandomValues` in the
  browser. React Native 0.86 has no global `crypto`.

## AuditEvent (application → Audit Hub)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://audit-hub.invalid/schema/v1/event.schema.json",
  "title": "AuditEvent",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "eventId",
    "sourceSeq",
    "occurredAt",
    "catalogVersion",
    "category",
    "action",
    "outcome",
    "actor"
  ],
  "properties": {
    "schemaVersion": { "const": 1 },
    "eventId": {
      "$ref": "#/$defs/uuidv7",
      "description": "Idempotency key, generated once at the origin."
    },
    "sourceSeq": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991,
      "description": "Gapless per sequence epoch, assigned by the connector queue in commit order."
    },
    "occurredAt": { "type": "string", "format": "date-time" },
    "catalogVersion": {
      "type": "string",
      "pattern": "^[0-9a-f]{16}$",
      "description": "Digest of the catalog the event was written against."
    },
    "category": { "enum": ["security", "audit", "access", "system"] },
    "action": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_]{0,31}\\.[a-z][a-z0-9_]{0,31}\\.[a-z][a-z0-9_]{0,31}$",
      "description": "domain.entity.verb"
    },
    "outcome": { "enum": ["success", "failure", "denied"] },
    "severity": {
      "enum": ["info", "low", "medium", "high", "critical"],
      "description": "Optional: the catalog's default applies."
    },
    "reason": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_]{0,63}$",
      "description": "Code for failure/denied: invalid_credentials, rate_limited, …"
    },
    "actor": { "$ref": "#/$defs/actor" },
    "resource": { "$ref": "#/$defs/resource" },
    "change": { "$ref": "#/$defs/change" },
    "request": { "$ref": "#/$defs/request" },
    "network": { "$ref": "#/$defs/network" },
    "client": { "$ref": "#/$defs/client" },
    "location": { "$ref": "#/$defs/location" },
    "clientDeclared": {
      "type": "array",
      "uniqueItems": true,
      "maxItems": 6,
      "items": { "enum": ["occurredAt", "client", "location", "details", "resource", "change"] },
      "description": "Sections the application's server did not observe itself."
    },
    "details": {
      "type": "object",
      "description": "Validated against the action's details spec in the catalog. ≤ 8 KiB serialized, depth ≤ 3."
    }
  },
  "$defs": {
    "uuidv7": {
      "type": "string",
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "id": { "type": "string", "pattern": "^[A-Za-z0-9._:-]{1,128}$" },
    "hmac": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "label": { "type": "string", "minLength": 1, "maxLength": 128 },
    "actor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "properties": {
        "type": { "enum": ["user", "service", "system", "anonymous"] },
        "id": { "$ref": "#/$defs/id" },
        "role": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_-]{0,63}$",
          "description": "Role at the time of the event."
        },
        "label": {
          "$ref": "#/$defs/label",
          "description": "Who it is, in words: the person's name, or their email masked at the origin (j***@e***.com) when the application has no name. Personal: stored in the satellite table."
        },
        "phoneLabel": {
          "type": "string",
          "pattern": "^•••• [0-9]{4}$",
          "description": "The person's phone, masked at the origin: its last four digits only. Personal, like the label. Never the number."
        },
        "emailHmac": {
          "$ref": "#/$defs/hmac",
          "description": "HMAC-SHA256(app pseudonym key, normalized email)."
        },
        "emailHmacShared": {
          "$ref": "#/$defs/hmac",
          "description": "Only when the app opted in to cross-app correlation."
        },
        "impersonatorId": { "$ref": "#/$defs/id" },
        "sessionRef": {
          "$ref": "#/$defs/hmac",
          "description": "HMAC of the session family id; never the id."
        }
      },
      "allOf": [
        { "if": { "properties": { "type": { "const": "user" } } }, "then": { "required": ["id"] } },
        {
          "if": { "properties": { "type": { "const": "anonymous" } } },
          "then": { "not": { "required": ["id"] } }
        }
      ]
    },
    "resource": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "properties": {
        "type": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,63}$" },
        "id": { "$ref": "#/$defs/id" },
        "label": { "$ref": "#/$defs/label" },
        "parent": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "id"],
          "properties": {
            "type": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,63}$" },
            "id": { "$ref": "#/$defs/id" }
          }
        }
      }
    },
    "change": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "before": {
          "type": "object",
          "description": "Fields from the explicit select, read in the transaction before the write. Sensitive values are '[REDACTED]'."
        },
        "after": { "type": "object" },
        "changedFields": {
          "type": "array",
          "maxItems": 64,
          "uniqueItems": true,
          "items": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_.]{0,127}$" }
        }
      }
    },
    "request": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "requestId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,128}$" },
        "traceId": { "type": "string", "pattern": "^[0-9a-f]{32}$" },
        "method": { "enum": ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] },
        "route": {
          "type": "string",
          "pattern": "^/[A-Za-z0-9/:._~-]{0,255}$",
          "description": "The route template (/api/users/:id), never the URL."
        },
        "status": {
          "type": "integer",
          "minimum": 100,
          "maximum": 599,
          "description": "The status actually sent."
        },
        "durationMs": { "type": "integer", "minimum": 0, "maximum": 3600000 }
      }
    },
    "network": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "ip": {
          "type": "string",
          "maxLength": 45,
          "anyOf": [{ "format": "ipv4" }, { "format": "ipv6" }],
          "description": "clientIp(req) of the application's API."
        },
        "userAgent": { "type": "string", "maxLength": 512 },
        "clientHints": {
          "type": "object",
          "additionalProperties": false,
          "description": "What a Chromium browser says in its Sec-CH-UA headers (clientHintsFromHeaders), where its user agent no longer tells: its real brand, the system's version (Windows 11), a phone's model. Personal, like the user agent.",
          "properties": {
            "brands": {
              "type": "array",
              "minItems": 1,
              "maxItems": 8,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["brand", "version"],
                "properties": {
                  "brand": { "type": "string", "minLength": 1, "maxLength": 64 },
                  "version": { "type": "string", "minLength": 1, "maxLength": 32 }
                }
              }
            },
            "platform": { "type": "string", "minLength": 1, "maxLength": 32 },
            "platformVersion": { "type": "string", "minLength": 1, "maxLength": 32 },
            "model": { "type": "string", "minLength": 1, "maxLength": 64 },
            "mobile": { "type": "boolean" }
          }
        }
      }
    },
    "client": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "properties": {
        "type": { "enum": ["web", "ios", "android", "api", "job"] },
        "appVersion": { "type": "string", "pattern": "^[A-Za-z0-9.+_-]{1,32}$" },
        "appBuild": { "type": "string", "pattern": "^[A-Za-z0-9.+_-]{1,32}$" },
        "updateId": { "type": "string", "format": "uuid" },
        "os": { "type": "string", "maxLength": 32 },
        "osVersion": { "type": "string", "maxLength": 32 },
        "deviceModel": { "type": "string", "maxLength": 64 },
        "deviceId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9-]{8,64}$",
          "description": "Per-installation random id (not IDFV / Android ID)."
        },
        "locale": { "type": "string", "pattern": "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$" },
        "timeZone": {
          "type": "string",
          "pattern": "^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$",
          "maxLength": 64
        },
        "networkType": {
          "enum": ["wifi", "cellular", "ethernet", "vpn", "none", "other", "unknown"]
        },
        "route": {
          "type": "string",
          "pattern": "^/[A-Za-z0-9/:[\\]()._~-]{0,255}$",
          "description": "Screen route pattern, never the path with ids."
        },
        "sdk": {
          "type": "object",
          "additionalProperties": false,
          "required": ["name", "version"],
          "properties": {
            "name": { "type": "string", "pattern": "^[a-z0-9@/._-]{1,64}$" },
            "version": {
              "type": "string",
              "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+([+-][A-Za-z0-9.-]{1,32})?$"
            }
          }
        }
      }
    },
    "location": {
      "type": "object",
      "additionalProperties": false,
      "required": ["latitude", "longitude", "accuracyM", "capturedAt"],
      "description": "Only with the user's location consent. Approximate (accuracy of 1 km or more): rounded to 2 decimals (≈1.1 km) on the device. Precise, only with consent to the precise position and an accuracy under 1 km: 5 decimals (≈1.1 m). Audit Hub rounds again by the same rule.",
      "properties": {
        "latitude": { "type": "number", "minimum": -90, "maximum": 90 },
        "longitude": { "type": "number", "minimum": -180, "maximum": 180 },
        "accuracyM": { "type": "integer", "minimum": 1, "maximum": 100000 },
        "capturedAt": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

### How Audit Hub validates and sanitizes it

A bad field never rejects the batch. It rejects its event only when the field is part of the
event's identity.

| Field class                                                                                        | When it is invalid                                              |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Identity: `schemaVersion`, `eventId`, `sourceSeq`, `occurredAt`, `action`, `outcome`, `actor.type` | the event is **rejected** with a reason                         |
| Optional sections and fields                                                                       | the field is **dropped** and listed in `droppedFields`          |
| Strings longer than their maximum (labels, user agent, details strings)                            | **truncated** (on a code point) and listed in `truncatedFields` |

Every string is also normalized:

- NFC normalization;
- NUL and C0/C1 controls removed (PostgreSQL rejects `\u0000`; tab is kept);
- lone surrogates replaced with U+FFFD.

Strings are stored and shown as text only, so `<script>`, `${alert(1)}` and `" onmouseover=`
travel unchanged and render inertly.

Other checks:

- `occurredAt` more than 5 minutes in the future is set to `recordedAt` and flagged
  `occurredAtAdjusted`. Older than the category's retention: **rejected** (`occurred_at_too_old`).
- `category` must equal the catalog's category for `action` (`category_mismatch`). `severity`
  absent means the catalog's default.
- `audit_access` is reserved for Audit Hub itself (`category_reserved`).
- `location` is rounded again by its accuracy: under 1000 m (precise) to 5 decimals, with
  `accuracyM` at least 1; otherwise to 2 decimals, with `accuracyM` raised to at least 1000.
- `actor.phoneLabel` that is not masked (`•••• 1234`) is **dropped**: a number in clear never
  gets in. `network.clientHints` is kept field by field (a malformed one is dropped alone).
- These fields are additive: they keep the contract's version (1).
- `actor.emailHmacShared` is dropped unless the app enabled correlation.
- `change.before` and `change.after` values at the catalog's **sensitive** paths must arrive as
  `"[REDACTED]"`. Anything else is replaced with that marker and flagged `sensitiveUnmasked`, and
  the per-app counter goes up. Values at **personal** paths are moved to the satellite table, and
  the event keeps `{"$personal": true}`.

## ClientEvent (device → its own backend)

This is a subset: the device cannot set `sourceSeq`, `actor`, `network`, `request`, `category` or
`catalogVersion`. The backend fills them in.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://audit-hub.invalid/schema/v1/client-event.schema.json",
  "title": "ClientEvent",
  "type": "object",
  "additionalProperties": false,
  "required": ["eventId", "occurredAt", "action", "outcome", "client"],
  "properties": {
    "eventId": { "$ref": "event.schema.json#/$defs/uuidv7" },
    "occurredAt": { "type": "string", "format": "date-time" },
    "action": { "$ref": "event.schema.json#/properties/action" },
    "outcome": { "enum": ["success", "failure", "denied"] },
    "reason": { "$ref": "event.schema.json#/properties/reason" },
    "resource": { "$ref": "event.schema.json#/$defs/resource" },
    "client": { "$ref": "event.schema.json#/$defs/client" },
    "location": { "$ref": "event.schema.json#/$defs/location" },
    "details": { "type": "object" }
  }
}
```

`POST /api/audit/client-events` (on the application's API, `@Auth()`, at most 50 events, 64 kB,
rate limit 30 requests a minute per user):

- `action` must be in the catalog with `source: client` or `both`. A device can never emit
  `auth.session.signed_in`.
- `actor` comes from the token. `network.ip` is `clientIp(req)` and `network.userAgent` the
  header. `request.requestId` is the request's id.
- `clientDeclared` becomes `["occurredAt", "client"]`, plus `"location"`, `"details"`,
  `"resource"` or `"change"` when present.
- `occurredAt` older than 7 days or more than 5 minutes ahead is clamped to the server time and
  flagged.
- Insert with `ON CONFLICT (event_id) DO NOTHING`. The answer is `{ results: [{ eventId, status }] }`.

## Catalog document

An application publishes it with `PUT /api/ingest/catalog`, when it boots (the forwarder does it
before its first batch) and optionally from CI. Its version is the first 16 hex characters of
SHA-256 over its canonical JSON (RFC 8785). Publishing the same document again answers
`unchanged`.

```json
{
  "catalogFormat": 1,
  "app": { "name": "my-project", "version": "1.4.2" },
  "responseActions": ["revoke_sessions"],
  "actions": {
    "auth.session.signed_in": {
      "category": "security",
      "severity": "info",
      "description": "A user signed in with their email and password.",
      "source": "server",
      "outcomes": ["success"],
      "tags": ["auth.sign_in"],
      "resourceType": "session",
      "userVisible": true,
      "details": {
        "fields": {
          "method": {
            "type": "enum",
            "values": ["password", "invitation", "sign_up"],
            "required": true
          },
          "mfa": { "type": "boolean" }
        }
      }
    },
    "account.profile.updated": {
      "category": "audit",
      "severity": "low",
      "description": "A user changed their name.",
      "source": "server",
      "outcomes": ["success"],
      "tags": [],
      "resourceType": "user",
      "userVisible": true,
      "change": { "fields": { "name": { "personal": true } } }
    },
    "auth.password.changed": {
      "category": "security",
      "severity": "medium",
      "description": "A user changed their password.",
      "source": "server",
      "outcomes": ["success", "failure"],
      "tags": ["auth.credential_changed"],
      "userVisible": true,
      "change": { "fields": { "passwordHash": { "sensitive": true } } }
    }
  }
}
```

Rules, checked when the catalog is published (the catalog is rejected with every problem listed):

- At most 500 actions and 512 KiB. Action names are `domain.entity.verb`, unique.
- `details.fields` and `change.fields` have at most 32 fields, one level. Field types:
  - `string` (`maxLength` ≤ 1024, default 256);
  - `integer` and `number` (`min`, `max`);
  - `boolean`;
  - `enum` (≤ 64 values);
  - `uuid`, `datetime`;
  - `id` (the id pattern), `ip`, `country` (ISO 3166-1 alpha-2);
  - `string[]` (`maxItems` ≤ 32).
    Each field can carry `required`, `personal` and `sensitive`. **There are no regex patterns, no
    `$ref` and no nesting**: Audit Hub compiles these specs to Zod, and a compromised publisher
    cannot inject a catastrophic regex (ReDoS).
- `tags` come from a closed vocabulary that the rules understand:
  - `auth.sign_in`, `auth.sign_in_failed`, `auth.sign_out`, `auth.session_reuse`;
  - `auth.credential_changed`, `auth.recovery`;
  - `iam.privilege_changed`, `iam.account_created`, `iam.account_disabled`;
  - `data.bulk_export`, `data.bulk_delete`, `data.read_other_user`;
  - `http.rejected`, `security.prompt_answered`, `response.executed`,
    `privacy.erasure_requested`.
- **Retention cannot be lowered by recategorizing.** A published action cannot move to a category
  with a shorter minimum retention (for example `security` to `system`); that publish is
  rejected.
- `responseActions` ⊆ `revoke_sessions | require_password_change | disable_account`. What Audit
  Hub may ask is the intersection of this list and the per-app setting in Audit Hub. Both default
  to empty.

### Base catalog (every flow of project-template-web)

`packages/audit-nestjs/src/catalog/base-catalog.ts` lists these actions, and each one comes with
its integration point (file and method of the template) in the connection guide:

| Action                                                                            | Cat.     | Sev.                | Template point                                                        | Note                                                                                              |
| --------------------------------------------------------------------------------- | -------- | ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `auth.session.signed_in`                                                          | security | info                | `AuthService.signIn` after `sessions.create`                          |                                                                                                   |
| `auth.session.sign_in_failed`                                                     | security | low                 | `AuthService.signIn`, before the 401                                  | actor anonymous + `emailHmac` (today the template records nothing)                                |
| `auth.session.signed_out`                                                         | security | info                | `SessionsService.retire(…, 'logout')`                                 |                                                                                                   |
| `auth.session.reuse_detected`                                                     | security | high                | `SessionsService.rotate` reuse branch (`:153-161`) and `retire`       | inside the committing tx                                                                          |
| `auth.session.revoked_all`                                                        | security | medium              | `SessionsService.revokeAll` / `revokeSessionsLocked`                  |                                                                                                   |
| `auth.password.changed` / `change_failed`                                         | security | medium/low          | `AccountService.changePassword`                                       |                                                                                                   |
| `auth.password_reset.requested`                                                   | security | info                | `PasswordResetService.request` → `queueLink`                          | `emailHmac` even for unknown addresses                                                            |
| `auth.password_reset.completed`                                                   | security | medium              | `PasswordResetService.confirm`                                        |                                                                                                   |
| `account.email.change_requested` / `changed` / `reverted` / `change_failed`       | security | low/medium/high/low | `EmailChangeService.request/confirm/revert`                           | personal: old and new address only as HMAC                                                        |
| `auth.sign_up.requested` / `confirmed` / `confirm_failed`                         | security | info/info/low       | `SignUpService.request/confirm`                                       |                                                                                                   |
| `iam.invitation.created` / `revoked` / `accepted`                                 | audit    | low                 | `InvitationsService.invite/revoke/accept`                             | `revoke` has no tx today: the guide adds one                                                      |
| `iam.user.created`                                                                | audit    | medium              | `createUser()` (CLI `user:create`)                                    | actor `system`                                                                                    |
| `iam.user.role_changed`                                                           | audit    | high                | template patch: `PATCH /api/users/:id` (`role`)                       | the template had no flow; its patch adds it                                                       |
| `iam.user.viewed` / `iam.users.listed`                                            | access   | info                | `UsersService.findVisible` (admin ≠ owner) / `list`                   | docs/authorization.md asks for it                                                                 |
| `http.request.cross_origin_refused`                                               | security | low                 | `FetchMetadataGuard`                                                  | no tx: own short tx                                                                               |
| `http.request.rate_limited`                                                       | security | low                 | `RateLimitGuard`, auth routes only                                    | sampled: first per IP+route per minute                                                            |
| `account.security_prompt.answered`                                                | security | info/high           | connector endpoint (answer)                                           | `not_me` ⇒ high                                                                                   |
| `audit.response_action.executed`                                                  | security | medium              | connector webhook handler                                             |                                                                                                   |
| `client.session.expired`, `client.link.rejected`, `client.security.csp_violation` | security | low                 | Expo / SPA connectors (`source: client`)                              |                                                                                                   |
| `iam.user.disabled` / `iam.user.enabled`                                          | security | high/medium         | template patch: `PATCH /api/users/:id` (`disabled`)                   | also from the `disable_account` response action                                                   |
| `auth.password.change_required`                                                   | security | medium              | template patch: `POST /api/users/:id/require-password-change`         | also from the `require_password_change` response action                                           |
| `account.user.deleted`                                                            | security | medium              | template patch: `POST /api/account/deletion`, `DELETE /api/users/:id` | tag `privacy.erasure_requested`: Audit Hub erases the subject's satellite data when it ingests it |
| `client.navigation.return_path_rejected`                                          | security | low                 | SPA connector: `auth/return-path.ts` refusal                          | `source: client`                                                                                  |

## Ingestion API (Audit Hub)

All `/api/ingest/*` and `/api/connector/*` routes are machine-to-machine. They follow the
template's recipe for a route without a user (docs/how-to.md): no `@Auth()`, listed in the public
list of `openapi.spec.ts` with their reason, and protected by `@AppSignature()`. The spec also
checks that every one of them declares the `auditSignature` security scheme
([ADR 0006](../../adr/0006-sign-ingestion-requests-with-hmac-sha256.md)). They stay inside the
template's defaults: the 100 kB JSON body limit, the global per-IP rate limit and no raw body.

### Request signing

| Header              | Value                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| `Audit-Key-Id`      | the key's public id (UUID)                                                          |
| `Audit-Timestamp`   | Unix seconds; accepted within ±300 s of Audit Hub's clock                           |
| `Audit-Nonce`       | 16 random bytes, base64url (22 chars); single-use per key for 10 min                |
| `Audit-Body-Digest` | `sha-256=<base64url>` of the body's **canonical JSON** (RFC 8785); for GET, of `""` |
| `Audit-Signature`   | `v1=<base64url HMAC-SHA256(secret, string-to-sign)>`                                |
| `User-Agent`        | `audit-nestjs/<version>`                                                            |

```
string-to-sign = "AUDIT-HMAC-SHA256-V1" LF
                 METHOD LF
                 PATH LF                       (no host; /api/ingest/events)
                 CANONICAL-QUERY LF            (sorted, RFC 3986-encoded; empty for POST)
                 TIMESTAMP LF
                 NONCE LF
                 KEY-ID LF
                 BODY-DIGEST
```

The digest covers the canonical form of the parsed JSON, not its raw bytes. The verifier
re-serializes what the template's body parser already produced (`canonicalJson()` in
`packages/audit-contract`, the same function the content hashes use), so neither Audit Hub nor a
connected application needs `rawBody` or a parser of its own. The contract keeps every number
inside ±2^53 and forbids duplicate keys, the two cases where parsing and re-serializing could
differ.

Audit Hub checks, in this order:

1. The headers have the right format.
2. The timestamp is inside the window.
3. The key exists, is not revoked or expired, and its app is not suspended.
4. The digest equals the canonical JSON of the parsed body.
5. The HMAC matches, compared in constant time.
6. The nonce has not been used: `INSERT … ON CONFLICT DO NOTHING` into `ingest_nonces`, done only
   after the HMAC is valid, so nobody can fill the table without a key.

Any failure answers `401` with the template's envelope and an `Audit-Error` header:

- `unauthorized`, for every failure that would reveal something;
- `timestamp_skew`, with the `Date` header so the connector can compute its offset;
- `app_suspended` (`403`).

Each failure counts in `app_ingest_requests_total{outcome}`, and the log line holds only the key
id.

**Rate limits, inside the template's mechanism:**

- The global per-IP limit stays as it is (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_SEC`, counted
  per route).
- After the signature, a per-app quota (`rate_limit_per_minute`, 120 by default) is counted in the
  template's rate-limit store (`RATE_LIMIT_STORE`, memory or Redis) and answers the same `429`
  with `Retry-After`.
- The connector paces itself: at most one batch every 2 s per instance, and it waits out
  `Retry-After`.
- A deployment with many applications behind one egress IP raises `RATE_LIMIT_MAX`, an existing
  variable.

**Key rotation without an outage:** an app has at most two valid keys. Creating a new one sets
`expiresAt = now + grace` on the old one (7 days by default). Both verify until then, so the
operator updates the variables and redeploys at leisure.

### `POST /api/ingest/events`

Bounded by the template's default JSON body limit: at most 100 events and 100 kB per request (the
body parser answers `413` above it), 16 KiB per event. The connector splits batches by size before
sending.

Request:

```json
{
  "contractVersion": 1,
  "connector": { "name": "audit-nestjs", "version": "1.0.0" },
  "sequenceEpoch": "0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70",
  "events": [{ "…": "AuditEvent" }]
}
```

Response `200` (even when some events were rejected):

```json
{
  "data": {
    "results": [
      {
        "index": 0,
        "eventId": "0199…",
        "sourceSeq": 1201,
        "status": "accepted",
        "truncatedFields": ["actor.label"]
      },
      { "index": 1, "eventId": "0199…", "sourceSeq": 1202, "status": "duplicate" },
      {
        "index": 2,
        "eventId": "0199…",
        "sourceSeq": 1203,
        "status": "rejected",
        "reason": "action_unknown",
        "retryable": false
      },
      {
        "index": 3,
        "eventId": "0199…",
        "sourceSeq": 1204,
        "status": "rejected",
        "reason": "catalog_version_unknown",
        "retryable": true
      }
    ],
    "accepted": 1,
    "duplicates": 1,
    "rejected": 2
  },
  "message": "Operation successful"
}
```

Rejection reasons:

- `schema_invalid` (with the first paths)
- `action_unknown`
- `catalog_version_unknown` (**retryable**)
- `details_invalid`
- `category_mismatch`
- `category_reserved`
- `occurred_at_too_old`
- `sequence_conflict` (the same `sourceSeq` with another `eventId`: alert)
- `contract_version_unsupported`

The connector deletes accepted, duplicate and non-retryable rejected rows. Retryable ones stay with
backoff.

**Every result consumes its `sourceSeq`.** A rejected event is stored in `ingest_exceptions`: its
seq, reason and error paths, never its raw payload. A duplicate that arrives with a new seq is
stored there too. This way gap detection only flags numbers that never arrived.

Whole-request errors use the template's envelope:

- `400` (envelope invalid, or `Audit-Error: contract_version_unsupported` with the supported
  versions in the message);
- `401` / `403` (above);
- `413`, `415`;
- `429` with `Retry-After`, from the template's per-IP limit or from the per-app quota (120
  requests a minute by default);
- `503` with `Retry-After` when the database is down.

### `PUT /api/ingest/catalog`

Request: `{ "contractVersion": 1, "catalog": CatalogDocument }`.

`200`:

```json
{ "data": { "version": "9f2c1a7b3e5d4c21", "status": "created", "actions": 34 } }
```

`status` is `created` or `unchanged`. `400` lists every problem, as `path: message`.

### `POST /api/ingest/heartbeat`

Every 60 seconds from every connector instance.

```json
{
  "contractVersion": 1,
  "connector": { "name": "audit-nestjs", "version": "1.0.0" },
  "instanceId": "0199e0b1-…",
  "appVersion": "1.4.2",
  "catalogVersion": "9f2c1a7b3e5d4c21",
  "sequenceEpoch": "0199e0b1-…",
  "lastAssignedSeq": 1204,
  "queue": { "size": 12, "oldestAgeSeconds": 3, "retrying": 0, "discardedAtSignOut": 0 },
  "responseActions": ["revoke_sessions"]
}
```

`200`:

```json
{
  "data": {
    "serverTime": "…",
    "contractVersions": [1],
    "lastContiguousSeq": 1203,
    "connectorNotice": null
  }
}
```

`connectorNotice` carries a deprecation warning when the connector's contract version will stop
being accepted.

### Sequence and gaps

- `sequenceEpoch` is a UUID the connector creates together with its counter row. A database
  restore, or an operator reset (`pnpm --filter api audit:connector reset-sequence`), creates a
  new epoch. Audit Hub then opens a new sequence and records a `system` event
  `audit.sequence.epoch_started`, which needs to be acknowledged in the panel.
- Audit Hub keeps `contiguousThrough` per (app, epoch). Missing numbers older than 10 minutes
  become a `sequence_gaps` row, which feeds the gauge `app_ingest_sequence_gap_events` and the
  alert `AuditHubSequenceGap`. A late arrival closes the gap by itself.
- Heartbeats older than the app's timeout (300 s by default) raise `AuditHubAppSilent`.

## Query API for applications (Audit Hub, signed)

| Route                                                        | For                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/connector/subjects/:subject/activity?cursor&limit` | "My account's security": catalog actions with `userVisible: true`, minimal fields (action, outcome, time, client summary, country/city). No IP.        |
| `GET /api/connector/subjects/:subject/export?cursor`         | Right of access: every event of the subject, with the satellite data still kept                                                                        |
| `POST /api/connector/subjects/:subject/erasure`              | Right to erasure (`ErasureRequest`, optional): scope `personal` deletes the subject's satellite rows, `events` their events too (not under legal hold) |

The erasure's body, `{ "scope": "personal" | "events" }`, is optional (none: `personal`, as
before it existed). Its answer, `ErasureResult`: `personalDeleted`, `locationDeleted`, `held`
and, for `events`, `eventsDeleted` (the sealed ones, now) and `eventsPending` (deleted within a
day, once sealed). The connector calls it from `AuditErasureService.erase(subject, scope)`.

Erasure has a second path that can't be lost: an event whose action carries the tag
`privacy.erasure_requested` (the base catalog's `account.user.deleted`) travels through the
application's queue, and Audit Hub runs the same erasure (`personal`) when it ingests it. An
account deletion in the application thus always reaches Audit Hub, even when Audit Hub is down at
that moment.

After an erasure the subject is **blocked** in that application (LFPDPPP art. 24): `activity`
and `export` leave out what occurred up to their last erasure (for a deleted account, an empty
page, `{ "items": [] }`, which every contract version reads), unless an active legal hold names
the subject. What occurs afterwards (an account that stays) is answered as usual.

`:subject` is the application's user id (the id pattern; it is not called `…Id`, so the template's
OpenAPI annotation does not force a UUID). Every call records an `audit_access` event. The
application's API exposes the first one as `GET /api/account/activity`, limited to the caller.

An application whose service ended is **retired** by Audit Hub's administrators: its events, then
its keys, are deleted, and every signed request is refused from then on.

## Webhooks (Audit Hub → application)

`POST <app webhook URL>` (the template's path is `/api/audit/webhooks`):

| Header              | Value                                                                |
| ------------------- | -------------------------------------------------------------------- |
| `Audit-Webhook-Id`  | delivery UUID (idempotency key on the app side)                      |
| `Audit-Timestamp`   | Unix seconds (the app accepts ±300 s)                                |
| `Audit-Body-Digest` | `sha-256=<base64url>` of the canonical JSON                          |
| `Audit-Signature`   | `v1=<sig>` or, during a secret rotation, `v1=<sig-new> v1=<sig-old>` |

The signature uses the same string-to-sign, with `WEBHOOK-ID` in the place of `NONCE` and `KEY-ID`
set to the app's slug.

```json
{
  "id": "0199…",
  "type": "security.sign_in_suspicious",
  "createdAt": "…",
  "contractVersion": 1,
  "data": {
    "subject": "user-uuid",
    "eventId": "0199…",
    "occurredAt": "…",
    "signals": ["new_device", "new_country"],
    "context": {
      "country": "ES",
      "city": "Madrid",
      "clientType": "android",
      "deviceModel": "Pixel 9"
    }
  }
}
```

| `type`                        | `data`                                                          |
| ----------------------------- | --------------------------------------------------------------- |
| `ping`                        | `{}` (connection test from the wizard)                          |
| `alert.created`               | `{ alertId, rule, severity, subject?, summary, firstEventId }`  |
| `security.sign_in_suspicious` | as above                                                        |
| `response_action.requested`   | `{ actionId, action, subject, reason, requestedAt, expiresAt }` |

The app answers:

- `200` with `{ data: { status: "accepted" | "refused" | "unsupported" } }`, for a delivery it
  verified and handled or already recorded;
- `401` for a bad signature, which Audit Hub does not retry, and alerts;
- `5xx` or a timeout, which Audit Hub retries with backoff: 30 s doubling to 1 h, 12 attempts.

The outcome of a response action comes back as the event `audit.response_action.executed`
`{ actionId, action, result: succeeded | failed | refused | unsupported }`.

## Versions and compatibility

- `contractVersion` = the event's `schemaVersion`, an integer that only goes up on a breaking
  change. Additive changes (new optional fields, new webhook types, new tags) keep the version.
- Audit Hub accepts **the current and the previous version**. The heartbeat answers with the
  supported versions and a notice. When a version is dropped, `400 contract_version_unsupported`
  stops nothing on the application's side: events stay in the queue, and the backlog alert says
  why.
- Every request names its connector and version (`connector` in the body, `User-Agent`). Audit
  Hub keeps the last one seen per app and shows it in the panel.
- Webhooks carry `contractVersion`. An app ignores unknown `type` values with `200 unsupported`.
