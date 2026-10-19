import { type ClientHints, ClientHintsSchema } from './event.js';
import { LIMITS } from './version.js';

// Client hints (RFC 8942; WICG User-Agent Client Hints): what a Chromium
// browser says of itself in Sec-CH-UA headers, where its user agent no longer
// tells (frozen to "Windows NT 10.0", "Chrome/..." for Edge and Brave). The low
// entropy ones (brands, mobile, platform) come with every request over HTTPS;
// the others (the full version list, the platform's version, the model) only
// after the page's response asked for them in Accept-CH.

/** The headers read, in lower case, as Node and Express name them. */
export const CLIENT_HINT_HEADERS = [
  'sec-ch-ua',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-platform',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-model',
  'sec-ch-ua-mobile',
] as const;

/** What a page sends in Accept-CH so that its requests carry the hints that tell most. */
export const ACCEPT_CLIENT_HINTS =
  'Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model';

/** Longer header values are cut first: the parser never sees more. */
const MAX_HEADER = 512;
// "Brand";v="version", each part a quoted string of a structured field list.
const BRAND = /"((?:[^"\\]|\\.)*)"\s*;\s*v\s*=\s*"((?:[^"\\]|\\.)*)"/g;
// The GREASE brand every Chromium adds so that no one parses the list strictly:
// "Not.A/Brand", "Not A(Brand", ";Not A Brand"...
const GREASE = /not.?a.?brand/i;

const unquote = (value: string | undefined): string | undefined => {
  const text = value?.slice(0, MAX_HEADER).trim();
  if (text === undefined || text === '') return undefined;
  const inner = /^"((?:[^"\\]|\\.)*)"$/.exec(text)?.[1] ?? text;
  const unescaped = inner.replace(/\\(.)/g, '$1').trim();
  return unescaped === '' ? undefined : unescaped;
};

function brandsOf(value: string | undefined): ClientHints['brands'] {
  const text = value?.slice(0, MAX_HEADER);
  if (text === undefined) return undefined;
  const brands: NonNullable<ClientHints['brands']> = [];
  for (const [, rawBrand = '', rawVersion = ''] of text.matchAll(BRAND)) {
    const brand = rawBrand.replace(/\\(.)/g, '$1').trim().slice(0, LIMITS.hintBrand);
    const version = rawVersion.replace(/\\(.)/g, '$1').trim().slice(0, LIMITS.hintVersion);
    if (brand === '' || version === '' || GREASE.test(brand)) continue;
    brands.push({ brand, version });
    if (brands.length === LIMITS.hintBrands) break;
  }
  return brands.length === 0 ? undefined : brands;
}

/**
 * The client hints of a request, from its headers (`header` answers one by
 * its lower-case name), as an event carries them; undefined when it sent none.
 * Anything malformed is left out, never guessed.
 */
export function clientHintsFromHeaders(
  header: (name: (typeof CLIENT_HINT_HEADERS)[number]) => string | undefined,
): ClientHints | undefined {
  const mobile = header('sec-ch-ua-mobile')?.trim();
  const brands = brandsOf(header('sec-ch-ua-full-version-list')) ?? brandsOf(header('sec-ch-ua'));
  const candidate: ClientHints = {
    ...(brands === undefined ? {} : { brands }),
    ...optional('platform', unquote(header('sec-ch-ua-platform')), LIMITS.hintPlatform),
    ...optional(
      'platformVersion',
      unquote(header('sec-ch-ua-platform-version')),
      LIMITS.hintVersion,
    ),
    ...optional('model', unquote(header('sec-ch-ua-model')), LIMITS.deviceModel),
    ...(mobile === '?1' ? { mobile: true } : mobile === '?0' ? { mobile: false } : {}),
  };
  if (Object.keys(candidate).length === 0) return undefined;
  const parsed = ClientHintsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function optional<K extends 'platform' | 'platformVersion' | 'model'>(
  key: K,
  value: string | undefined,
  limit: number,
): Partial<Record<K, string>> {
  return value === undefined
    ? {}
    : ({ [key]: value.slice(0, limit) } as Partial<Record<K, string>>);
}
