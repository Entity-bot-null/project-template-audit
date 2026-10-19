import type { DeviceFacts, DevicePosition } from './audit.ports';
import {
  LOCATION_DECIMALS,
  LOCATION_MAX_ACCURACY_M,
  LOCATION_MAX_AGE_MS,
  LOCATION_MIN_ACCURACY_M,
  LOCATION_PRECISE_DECIMALS,
  SDK,
} from './audit.constants';
import {
  CLIENT_ROUTE_PATTERN,
  type ClientInfo,
  DEVICE_ID_PATTERN,
  LIMITS,
  LOCALE_PATTERN,
  type LocationInfo,
  type RandomFill,
  TIME_ZONE_PATTERN,
  toWellFormed,
  VERSION_TOKEN_PATTERN,
} from './contract';

// What an event says about the phone (the contract's client section), from
// what the system reports: each value checked against the contract, and left
// out when it does not fit. Never an advertising id, IDFV or Android ID: the
// device id is a random id of this installation.

type NetworkType = NonNullable<ClientInfo['networkType']>;

const NETWORK_TYPE_OF: Record<string, NetworkType> = {
  WIFI: 'wifi',
  CELLULAR: 'cellular',
  ETHERNET: 'ethernet',
  VPN: 'vpn',
  NONE: 'none',
  UNKNOWN: 'unknown',
};

/** expo-network's NetworkStateType as the contract names it; Bluetooth, WiMAX and the rest are "other". */
export function networkTypeOf(type: string | null): NetworkType | undefined {
  if (type === null) return undefined;
  return NETWORK_TYPE_OF[type] ?? 'other';
}

/** A short text of the system, well-formed and cut to the contract's limit; undefined when empty. */
function text(value: string | null, max: number): string | undefined {
  const trimmed = value === null ? '' : toWellFormed(value.trim());
  if (trimmed === '') return undefined;
  // Never a lone half of a surrogate pair at the cut.
  return toWellFormed(trimmed.slice(0, max));
}

const matching = (value: string | null, pattern: RegExp) =>
  value !== null && pattern.test(value) ? value : undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The client section of an event or a request, from the device's facts. */
export function clientInfoOf(
  facts: DeviceFacts,
  context: { deviceId: string; networkType?: string | null; route?: string },
): ClientInfo {
  const info: ClientInfo = {
    type: facts.platform === 'ios' || facts.platform === 'android' ? facts.platform : 'web',
  };
  // Each optional field, left out when the phone's value does not fit.
  const fields: Record<Exclude<keyof ClientInfo, 'type' | 'sdk'>, string | undefined> = {
    appVersion: matching(facts.appVersion, VERSION_TOKEN_PATTERN),
    appBuild: matching(facts.appBuild, VERSION_TOKEN_PATTERN),
    updateId: matching(facts.updateId, UUID)?.toLowerCase(),
    os: text(facts.os, LIMITS.os),
    osVersion: text(facts.osVersion, LIMITS.osVersion),
    deviceModel: text(facts.deviceModel, LIMITS.deviceModel),
    deviceId: matching(context.deviceId, DEVICE_ID_PATTERN),
    locale: matching(facts.locale, LOCALE_PATTERN),
    timeZone: matching(facts.timeZone, TIME_ZONE_PATTERN),
    networkType: networkTypeOf(context.networkType ?? null),
    route: matching(context.route ?? null, CLIENT_ROUTE_PATTERN),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) Object.assign(info, { [key]: value });
  }
  return { ...info, sdk: { name: SDK.name, version: SDK.version } };
}

/**
 * The headers the app sends with every request (RELEASES.md of the app
 * template): its version and build, its platform and this installation's
 * id. The API's connector reads them into its own events: a sign-in from a
 * device the account never used is "new_device".
 */
export function requestHeadersOf(facts: DeviceFacts, deviceId: string): Record<string, string> {
  const client = clientInfoOf(facts, { deviceId });
  const headers: Record<string, string> = { 'X-App-Platform': client.type };
  if (client.appVersion !== undefined) headers['X-App-Version'] = client.appVersion;
  if (client.appBuild !== undefined) headers['X-App-Build'] = client.appBuild;
  if (client.deviceId !== undefined) headers['X-Device-Id'] = client.deviceId;
  return headers;
}

/** A new installation id: 128 random bits as hex, nothing of the phone in it. */
export function newDeviceId(random: RandomFill): string {
  return Array.from(random(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  // + 0 turns -0 into 0.
  return Math.round(value * factor) / factor + 0;
};

/**
 * A position as an event may carry it, and only when it is recent: rounded
 * to 0.01° on the device, its accuracy no better than the rounding allows;
 * or, when the person allowed the precise position (`precise`) and the
 * system measured it better than a kilometre, at five decimals with the
 * accuracy it reported. Undefined for a position that is too old, or not a
 * position at all.
 */
export function locationOf(
  position: DevicePosition,
  now: number,
  precise = false,
): LocationInfo | undefined {
  const { latitude, longitude, accuracyM, capturedAt } = position;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(capturedAt)) {
    return undefined;
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  if (capturedAt > now || now - capturedAt > LOCATION_MAX_AGE_MS) return undefined;
  // Unknown (null, 0, negative): the rounding's own accuracy. Worse than the
  // contract allows: it says nothing of where the phone is.
  const accuracy =
    accuracyM === null || !Number.isFinite(accuracyM) || accuracyM <= 0
      ? LOCATION_MIN_ACCURACY_M
      : accuracyM;
  if (accuracy > LOCATION_MAX_ACCURACY_M) return undefined;
  if (precise && accuracy < LOCATION_MIN_ACCURACY_M) {
    return {
      latitude: round(latitude, LOCATION_PRECISE_DECIMALS),
      longitude: round(longitude, LOCATION_PRECISE_DECIMALS),
      accuracyM: Math.max(1, Math.round(accuracy)),
      capturedAt: new Date(capturedAt).toISOString(),
    };
  }
  return {
    latitude: round(latitude, LOCATION_DECIMALS),
    longitude: round(longitude, LOCATION_DECIMALS),
    accuracyM: Math.round(Math.max(accuracy, LOCATION_MIN_ACCURACY_M)),
    capturedAt: new Date(capturedAt).toISOString(),
  };
}
