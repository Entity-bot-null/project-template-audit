import { type LookupAddress, lookup as dnsLookup } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { canonicalIp, ipScope } from '../enrichment/ip.js';

// Webhooks go to URLs administrators type in (docs/adr/0013), so they must not
// reach Audit Hub's own network (SSRF): the address is checked when the
// connection opens, after DNS resolution, so a name that resolves to a private
// address (or starts doing so: DNS rebinding) is refused too. A fetch-shaped
// function on node:http, for createExternalHttpClient's injectable fetch;
// redirects are never followed (a 3xx is an answer like any other).

/** The destination resolved to an address outside the public internet. */
export class BlockedAddressError extends Error {
  constructor(readonly host: string) {
    super(`${host} resolves to an address outside the public internet`);
    this.name = 'BlockedAddressError';
  }
}

/** Whether a webhook may connect to `address`. */
export function isAllowedAddress(address: string, allowPrivate: boolean): boolean {
  if (allowPrivate) return true;
  const ip = canonicalIp(address);
  return ip !== undefined && ipScope(ip) === 'public';
}

/** DNS resolution that refuses a name with any address outside the public internet. */
export function guardedLookup(
  allowPrivate: boolean,
  resolve: typeof dnsLookup = dnsLookup,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      const list = addresses as unknown as LookupAddress[] | undefined;
      const done = callback;
      if (error !== null) {
        done(error, '');
        return;
      }
      const first = list?.[0];
      if (first === undefined) {
        done(new BlockedAddressError(hostname), '');
        return;
      }
      if (list?.some((entry) => !isAllowedAddress(entry.address, allowPrivate)) === true) {
        done(new BlockedAddressError(hostname), '');
        return;
      }
      if (options.all === true) done(null, list ?? []);
      else done(null, first.address, first.family);
    });
  };
}

export interface GuardedFetchOptions {
  allowPrivate: boolean;
  /** The answer is read up to this many bytes (an application's reply is tiny). */
  maxResponseBytes?: number;
  lookup?: typeof dnsLookup;
}

const NULL_BODY_STATUS = new Set([204, 205, 304]);

export function guardedFetch(options: GuardedFetchOptions): typeof fetch {
  const lookup = guardedLookup(options.allowPrivate, options.lookup);
  const maxBytes = options.maxResponseBytes ?? 64 * 1024;

  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const host = url.hostname.replace(/^\[|\]$/g, '');
      // A literal address is connected to without a lookup: checked here.
      if (isIP(host) !== 0 && !isAllowedAddress(host, options.allowPrivate)) {
        reject(new BlockedAddressError(host));
        return;
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        reject(new Error(`${url.protocol} is not http or https`));
        return;
      }
      const signal = init?.signal ?? undefined;
      // The caller's timeout as its own reason (createExternalHttpClient
      // reads a TimeoutError as a timeout).
      const fail = (error: unknown) => {
        const reason: unknown = signal?.aborted === true ? signal.reason : undefined;
        reject(
          reason instanceof Error
            ? reason
            : error instanceof Error
              ? error
              : new Error(String(error)),
        );
      };
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, name) => {
        headers[name] = value;
      });
      const client = url.protocol === 'https:' ? https : http;
      const request = client.request(
        url,
        { method: init?.method ?? 'GET', headers, lookup, signal },
        (response: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let tooLarge = false;
          response.on('data', (chunk: Buffer) => {
            if (tooLarge) return;
            size += chunk.length;
            if (size > maxBytes) {
              // Settled here: whatever the stream does next changes nothing.
              tooLarge = true;
              fail(new Error(`response larger than ${String(maxBytes)} bytes`));
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', fail);
          response.on('end', () => {
            if (tooLarge) return;
            const status = response.statusCode ?? 502;
            const answer = new Headers();
            for (const [name, value] of Object.entries(response.headers)) {
              for (const item of Array.isArray(value) ? value : [value]) {
                if (item !== undefined) answer.append(name, item);
              }
            }
            resolve(
              new Response(NULL_BODY_STATUS.has(status) ? null : Buffer.concat(chunks), {
                status,
                headers: answer,
              }),
            );
          });
        },
      );
      request.on('error', fail);
      if (typeof init?.body === 'string') request.write(init.body);
      request.end();
    });
}
