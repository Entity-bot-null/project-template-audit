import type { ClientHints } from 'audit-contract';
import Bowser from 'bowser';

// The family of a user agent (browser, OS, device class) for the "new device"
// rule and the explorer: never the full string, which stays in event_personal.

/** Longer user agents are cut first: the parser's regular expressions never see more. */
export const MAX_USER_AGENT_PARSED = 512;

export interface UserAgentFamily {
  uaBrowser?: string;
  uaOs?: string;
  uaDeviceClass?: string;
}

const DEVICE_CLASSES = new Set(['desktop', 'mobile', 'tablet', 'tv', 'bot']);

export function parseUserAgent(userAgent: string | undefined): UserAgentFamily {
  const text = userAgent?.slice(0, MAX_USER_AGENT_PARSED).trim() ?? '';
  // Bowser throws on an empty string.
  if (text === '') return {};
  let parsed: Bowser.Parser.ParsedResult;
  try {
    parsed = Bowser.parse(text);
  } catch {
    return {};
  }
  const result: UserAgentFamily = {};
  const browser = parsed.browser.name?.trim();
  if (browser !== undefined && browser !== '') result.uaBrowser = browser.slice(0, 64);
  const os = parsed.os.name?.trim();
  if (os !== undefined && os !== '') result.uaOs = os.slice(0, 64);
  const type = parsed.platform.type;
  if (type !== undefined && DEVICE_CLASSES.has(type)) result.uaDeviceClass = type;
  return result;
}

/** A user agent in words, for the people who read an event: the versions too. */
export interface UserAgentDetail {
  /** "Chrome 141.0.7390.65" */
  browser: string | null;
  /** "Windows 10", "macOS 14.5 (Sonoma)", "Android 15" */
  os: string | null;
  /** The device's maker and model when the agent says them: "Apple iPhone", "Samsung SM-S918B". */
  device: string | null;
}

const words = (...parts: (string | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ')
    .slice(0, 128) || null;

/**
 * Reads a whole user agent at display time (an event's detail): what
 * parseUserAgent keeps of it is the family only, for the rules; this is what
 * the string itself says, from the copy kept with the personal data. The
 * client hints, when the browser sent them, say what the user agent no
 * longer does (its real brand, Windows 11, a phone's model) and come first.
 */
export function describeUserAgent(
  userAgent: string | null | undefined,
  hints?: ClientHints | null,
): UserAgentDetail | null {
  const agent = fromAgent(userAgent);
  if (hints === null || hints === undefined) return agent;
  const brand = preferredBrand(hints.brands);
  return {
    browser: brand === undefined ? (agent?.browser ?? null) : words(brand.brand, brand.version),
    os: osOfHints(hints) ?? agent?.os ?? null,
    device: words(hints.model) ?? agent?.device ?? null,
  };
}

/** The browser's own brand: the first one that is not the engine they share. */
function preferredBrand(brands: ClientHints['brands']) {
  return brands?.find((entry) => entry.brand !== 'Chromium') ?? brands?.[0];
}

// The system from its hints: Windows tells 11 from 10 by its platform version
// (13 and up: 11; 1 to 10: 10; 0: 7, 8 or 8.1), which its user agent cannot.
function osOfHints({ platform, platformVersion }: ClientHints): string | null {
  if (platform === undefined) return null;
  if (platform === 'Windows') {
    const major = Number.parseInt(platformVersion ?? '', 10);
    if (Number.isNaN(major)) return null;
    return major >= 13 ? 'Windows 11' : major >= 1 ? 'Windows 10' : 'Windows 7, 8 or 8.1';
  }
  // Without its version, the user agent may still say more ("10.15.7 or later").
  if (platformVersion === undefined && platform === 'macOS') return null;
  return words(platform, platformVersion);
}

function fromAgent(userAgent: string | null | undefined): UserAgentDetail | null {
  const text = userAgent?.slice(0, MAX_USER_AGENT_PARSED).trim() ?? '';
  if (text === '') return null;
  let parsed: Bowser.Parser.ParsedResult;
  try {
    parsed = Bowser.parse(text);
  } catch {
    return null;
  }
  return {
    browser: words(parsed.browser.name, parsed.browser.version),
    os: osOf(parsed.os),
    device: words(parsed.platform.vendor, parsed.platform.model),
  };
}

// Browsers freeze what they say of the system: Windows 11 still says
// "Windows NT 10.0", and every macOS since 2020 says 10.15.7. Said as they
// are, never as a version the device may not run.
function osOf(os: Bowser.Parser.OSDetails): string | null {
  const name = os.name?.trim();
  const version = os.version?.trim();
  const versionName = os.versionName?.trim();
  if (name === 'Windows' && version === 'NT 10.0') return 'Windows 10 or 11';
  if (name === 'Windows' && versionName !== undefined && versionName !== '') {
    return `Windows ${versionName}`;
  }
  if (name === 'macOS' && version === '10.15.7') return 'macOS 10.15.7 or later';
  const text = words(name, version);
  return text === null ||
    versionName === undefined ||
    versionName === '' ||
    text.endsWith(versionName)
    ? text
    : `${text} (${versionName})`;
}
