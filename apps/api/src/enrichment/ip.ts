import { isIP } from 'node:net';

// What can be known about an IP without any database (docs/adr/0011): its
// canonical text and the kind of range it is in. A private or loopback
// address in an application's events usually means the application's
// TRUST_PROXY is wrong (it records its proxy instead of the client).

export type IpScope = 'public' | 'private' | 'loopback' | 'link_local' | 'shared' | 'reserved';

/** One text per address: IPv6 compressed and lowercase (RFC 5952), IPv4-mapped as IPv4. */
export function canonicalIp(ip: string): string | undefined {
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return undefined;
  const host = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped === null) return host;
  const high = Number.parseInt(mapped[1] ?? '0', 16);
  const low = Number.parseInt(mapped[2] ?? '0', 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function ipv4Number(ip: string): number {
  return ip.split('.').reduce((total, part) => total * 256 + Number(part), 0);
}

const inRange = (value: number, base: string, bits: number) => {
  const size = 2 ** (32 - bits);
  const start = ipv4Number(base);
  return value >= start && value < start + size;
};

function ipv4Scope(ip: string): IpScope {
  const value = ipv4Number(ip);
  if (inRange(value, '127.0.0.0', 8)) return 'loopback';
  if (
    inRange(value, '10.0.0.0', 8) ||
    inRange(value, '172.16.0.0', 12) ||
    inRange(value, '192.168.0.0', 16)
  ) {
    return 'private';
  }
  if (inRange(value, '169.254.0.0', 16)) return 'link_local';
  if (inRange(value, '100.64.0.0', 10)) return 'shared';
  if (
    inRange(value, '0.0.0.0', 8) ||
    inRange(value, '192.0.0.0', 24) ||
    inRange(value, '192.0.2.0', 24) ||
    inRange(value, '198.18.0.0', 15) ||
    inRange(value, '198.51.100.0', 24) ||
    inRange(value, '203.0.113.0', 24) ||
    inRange(value, '224.0.0.0', 4) ||
    inRange(value, '240.0.0.0', 4)
  ) {
    return 'reserved';
  }
  return 'public';
}

function ipv6Scope(ip: string): IpScope {
  if (ip === '::1') return 'loopback';
  if (ip === '::') return 'reserved';
  const head = ip.split(':')[0] ?? '';
  const first = head === '' ? 0 : Number.parseInt(head, 16);
  if ((first & 0xfe00) === 0xfc00) return 'private';
  if ((first & 0xffc0) === 0xfe80) return 'link_local';
  if (ip.startsWith('2001:db8:') || (first & 0xff00) === 0xff00) return 'reserved';
  return 'public';
}

/** The kind of range a canonical IP is in. */
export function ipScope(ip: string): IpScope {
  return isIP(ip) === 4 ? ipv4Scope(ip) : ipv6Scope(ip);
}
