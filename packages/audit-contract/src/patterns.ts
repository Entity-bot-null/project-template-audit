// The closed formats of the contract. Every pattern is anchored and bounded,
// with no nested quantifier: none can be made to backtrack (ReDoS).

/** An id of the application (user, resource): never an email, so no "@". */
export const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
/** HMAC-SHA256 or SHA-256 as lowercase hex. */
export const HEX64_PATTERN = /^[0-9a-f]{64}$/;
/** domain.entity.verb */
export const ACTION_PATTERN = /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}$/;
/** A short code: a failure reason, a role. */
export const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const ROLE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
export const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** The request ids the template accepts (request-context.middleware.ts). */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
/** W3C trace context trace id. */
export const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
/** A route template of the API (/api/users/:id), never a URL with values. */
export const ROUTE_PATTERN = /^\/[A-Za-z0-9/:._~-]{0,255}$/;
/** A screen's route pattern (Expo Router: /items/[id], (tabs) groups). */
export const CLIENT_ROUTE_PATTERN = /^\/[A-Za-z0-9/:[\]()._~-]{0,255}$/;
/** An application version or build number. */
export const VERSION_TOKEN_PATTERN = /^[A-Za-z0-9.+_-]{1,32}$/;
/** A per-installation random id. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
/** BCP 47 language tag (simplified). */
export const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
/** IANA time zone name. */
export const TIME_ZONE_PATTERN = /^[A-Za-z_]{1,32}(?:\/[A-Za-z0-9_+-]{1,32}){0,2}$/;
/** A connector or SDK name. */
export const SDK_NAME_PATTERN = /^[a-z0-9@/._-]{1,64}$/;
/** Semantic version. */
export const SEMVER_PATTERN = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[+-][A-Za-z0-9.-]{1,32})?$/;
/** First 16 hex characters of the catalog's SHA-256. */
export const CATALOG_VERSION_PATTERN = /^[0-9a-f]{16}$/;
/** RFC 9562 UUID version 7, lowercase. */
export const UUIDV7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** An Expo push token, as expo-notifications hands it to the app. */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/;
/** A connected application's short id (metrics label, URLs). */
export const APP_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
/** A field name in a catalog spec. */
export const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** An enum value in a catalog spec. */
export const ENUM_VALUE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** ISO 3166-1 alpha-2. */
export const COUNTRY_PATTERN = /^[A-Z]{2}$/;
/** A phone as an event may carry it: masked at the origin, its last four digits only (maskPhone). */
export const PHONE_LABEL_PATTERN = /^•••• [0-9]{4}$/;
