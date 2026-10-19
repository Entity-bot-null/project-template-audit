import type { LookupAddress, lookup as dnsLookup } from 'node:dns';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BlockedAddressError,
  guardedFetch,
  guardedLookup,
  isAllowedAddress,
} from './guarded-fetch.js';

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/slow') return; // never answers
    if (request.url === '/large') {
      response.end('x'.repeat(200));
      return;
    }
    if (request.url === '/empty') {
      response.writeHead(204);
      response.end();
      return;
    }
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'X-Echo': 'yes' });
      response.end(
        JSON.stringify({ method: request.method, body, auth: request.headers['x-key'] }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

/** A resolver that answers fixed addresses for any name. */
const resolver = (addresses: LookupAddress[], error: Error | null = null) =>
  ((_host: string, _options: unknown, callback: (...args: unknown[]) => void) => {
    callback(error, addresses);
  }) as unknown as typeof dnsLookup;

describe('isAllowedAddress', () => {
  it('allows the public internet only, unless private networks are allowed', () => {
    expect(isAllowedAddress('8.8.8.8', false)).toBe(true);
    expect(isAllowedAddress('2001:4860:4860::8888', false)).toBe(true);
    for (const address of [
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      'x',
    ]) {
      expect(isAllowedAddress(address, false), address).toBe(false);
    }
    expect(isAllowedAddress('127.0.0.1', true)).toBe(true);
  });
});

describe('guardedLookup', () => {
  const run = (lookup: ReturnType<typeof guardedLookup>, all: boolean) =>
    new Promise<{ error: Error | null; address: unknown; family: unknown }>((resolve) => {
      lookup('hooks.example.com', { all }, (error, address, family) => {
        resolve({ error, address, family });
      });
    });

  it('answers the addresses of a public name, in either form', async () => {
    const lookup = guardedLookup(false, resolver([{ address: '8.8.8.8', family: 4 }]));
    await expect(run(lookup, false)).resolves.toEqual({
      error: null,
      address: '8.8.8.8',
      family: 4,
    });
    await expect(run(lookup, true)).resolves.toMatchObject({
      error: null,
      address: [{ address: '8.8.8.8', family: 4 }],
    });
  });

  it('refuses a name with any private address (DNS rebinding included), or none', async () => {
    const mixed = guardedLookup(
      false,
      resolver([
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]),
    );
    expect((await run(mixed, false)).error).toBeInstanceOf(BlockedAddressError);
    expect((await run(guardedLookup(false, resolver([])), false)).error).toBeInstanceOf(
      BlockedAddressError,
    );
    const failing = guardedLookup(false, resolver([], new Error('ENOTFOUND')));
    expect((await run(failing, false)).error?.message).toBe('ENOTFOUND');
  });
});

describe('guardedFetch', () => {
  const local = (path: string) => `http://127.0.0.1:${String(port)}${path}`;

  it('sends the request and reads the answer, when private networks are allowed', async () => {
    const fetch = guardedFetch({ allowPrivate: true });
    const response = await fetch(local('/echo'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Key': 'k1' },
      body: '{"a":1}',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-echo')).toBe('yes');
    await expect(response.json()).resolves.toEqual({ method: 'POST', body: '{"a":1}', auth: 'k1' });
    const empty = await fetch(new Request(local('/empty')));
    expect(empty.status).toBe(204);
  });

  it('refuses a literal private address and a name that resolves to one', async () => {
    const fetch = guardedFetch({ allowPrivate: false });
    await expect(fetch(local('/echo'))).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(fetch(`http://[::1]:${String(1)}/`)).rejects.toBeInstanceOf(BlockedAddressError);
    const viaName = guardedFetch({
      allowPrivate: false,
      lookup: resolver([{ address: '127.0.0.1', family: 4 }]),
    });
    await expect(viaName(`http://hooks.example.com:${String(port)}/echo`)).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
  });

  it('gives up on a slow answer with the caller timeout, and on a large one', async () => {
    const fetch = guardedFetch({ allowPrivate: true, maxResponseBytes: 100 });
    await expect(fetch(local('/slow'), { signal: AbortSignal.timeout(100) })).rejects.toMatchObject(
      {
        name: 'TimeoutError',
      },
    );
    await expect(fetch(local('/large'))).rejects.toThrow(/larger than 100 bytes/);
    await expect(fetch('ftp://example.com/')).rejects.toThrow(/not http or https/);
  });
});
