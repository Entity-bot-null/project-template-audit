import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrichmentService, HOSTING_RISK_POINTS } from './enrichment.service.js';
import { type GeoIpReader, NO_GEOIP } from './geoip.js';
import { describeUserAgent, MAX_USER_AGENT_PARSED, parseUserAgent } from './user-agent.js';

const PIXEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

const geoip: GeoIpReader = {
  enabled: true,
  lookup: (ip) =>
    ip === '8.8.8.8'
      ? {
          country: 'MX',
          asn: 64500,
          subdivision: 'CDMX',
          city: 'Mexico City',
          latitude: 19.43,
          longitude: -99.13,
          accuracyKm: 10,
        }
      : { country: 'US' },
  ageDays: () => 12,
};

describe('parseUserAgent', () => {
  it('names the browser, the OS and the device class', () => {
    expect(parseUserAgent(PIXEL)).toEqual({
      uaBrowser: 'Chrome',
      uaOs: 'Android',
      uaDeviceClass: 'mobile',
    });
  });

  it('answers nothing for an empty, unknown or missing user agent', () => {
    expect(parseUserAgent(undefined)).toEqual({});
    expect(parseUserAgent('   ')).toEqual({});
    expect(parseUserAgent('okhttp')).toEqual({});
  });

  it('parses only the first 512 characters', () => {
    expect(parseUserAgent(`${PIXEL}${'x'.repeat(10_000)}`).uaBrowser).toBe('Chrome');
    expect(MAX_USER_AGENT_PARSED).toBe(512);
  });
});

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36',
      // Windows 11 says NT 10.0 too.
      { browser: 'Chrome 141.0.7390.65', os: 'Windows 10 or 11', device: null },
    ],
    [
      'Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0',
      { browser: 'Firefox 115.0', os: 'Windows 7', device: null },
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      // Every macOS since 2020 says 10.15.7.
      { browser: 'Safari 17.5', os: 'macOS 10.15.7 or later', device: 'Apple' },
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1 Safari/605.1.15',
      { browser: 'Safari 14.1', os: 'macOS 10.14.6 (Mojave)', device: 'Apple' },
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      { browser: 'Safari 18.1', os: 'iOS 18.1', device: 'Apple iPhone' },
    ],
    [PIXEL, expect.objectContaining({ os: expect.stringMatching(/^Android/) as string })],
  ])('reads %s with its versions', (userAgent, expected) => {
    expect(describeUserAgent(userAgent)).toEqual(expected);
  });

  it('puts the client hints first: the real brand, Windows 11, a phone model', () => {
    const edgeOnWindows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';
    expect(
      describeUserAgent(edgeOnWindows, {
        brands: [
          { brand: 'Microsoft Edge', version: '155.0.3405.80' },
          { brand: 'Chromium', version: '155.0.7390.65' },
        ],
        platform: 'Windows',
        platformVersion: '15.0.0',
      }),
    ).toEqual({ browser: 'Microsoft Edge 155.0.3405.80', os: 'Windows 11', device: null });
    // Brave says Chrome in its user agent; its hints say Brave.
    const brave = describeUserAgent(edgeOnWindows.replace(' Edg/155.0.0.0', ''), {
      brands: [
        { brand: 'Chromium', version: '141' },
        { brand: 'Brave', version: '141' },
      ],
      platform: 'Windows',
      platformVersion: '10.0.0',
    });
    expect(brave).toMatchObject({ browser: 'Brave 141', os: 'Windows 10' });
    expect(
      describeUserAgent(PIXEL, {
        platform: 'Android',
        platformVersion: '15.0.0',
        model: 'Pixel 9',
      }),
    ).toMatchObject({ os: 'Android 15.0.0', device: 'Pixel 9' });
    expect(describeUserAgent(null, { platform: 'Windows', platformVersion: '0.3.0' })).toEqual({
      browser: null,
      os: 'Windows 7, 8 or 8.1',
      device: null,
    });
    // Hints that say little leave the user agent's word: a Mac without its
    // version, Windows without one, only the engine.
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    expect(
      describeUserAgent(mac, {
        brands: [{ brand: 'Chromium', version: '141' }],
        platform: 'macOS',
      }),
    ).toMatchObject({ browser: 'Chromium 141', os: 'macOS 10.15.7 or later' });
    expect(describeUserAgent(edgeOnWindows, { platform: 'Windows' })?.os).toBe('Windows 10 or 11');
    expect(
      describeUserAgent(edgeOnWindows, { platform: 'Linux', platformVersion: '6.10.0' })?.os,
    ).toBe('Linux 6.10.0');
  });

  it('reads nothing of an empty or missing agent, and bounds what it parses', () => {
    expect(describeUserAgent(null)).toBeNull();
    expect(describeUserAgent(undefined)).toBeNull();
    expect(describeUserAgent('  ')).toBeNull();
    expect(describeUserAgent('okhttp')).toEqual({ browser: null, os: null, device: null });
    const long = describeUserAgent(`${PIXEL}${'x'.repeat(10_000)}`);
    expect(long?.browser).toMatch(/^Chrome/);
  });
});

describe('EnrichmentService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('adds the place and network of a public IP, and the hosting risk', () => {
    const service = new EnrichmentService(geoip, new Set([64500]));
    expect(service.geolocation).toBe(true);
    expect(service.enrich({ network: { ip: '8.8.8.8', userAgent: PIXEL } })).toEqual({
      uaBrowser: 'Chrome',
      uaOs: 'Android',
      uaDeviceClass: 'mobile',
      geoCountry: 'MX',
      geoAsn: 64500,
      geoSubdivision: 'CDMX',
      geoCity: 'Mexico City',
      geoLatitude: 19.43,
      geoLongitude: -99.13,
      geoAccuracyKm: 10,
      riskSignals: [HOSTING_RISK_POINTS],
    });
    expect(service.isHosting(64500)).toBe(true);
    expect(service.isHosting(64501)).toBe(false);
    expect(service.isHosting(null)).toBe(false);
    expect(service.enrich({ network: { ip: '1.1.1.1' } })).toEqual({ geoCountry: 'US' });
  });

  it('never looks up private addresses, and does nothing without a database', () => {
    const lookup = vi.spyOn(geoip, 'lookup');
    const service = new EnrichmentService(geoip, new Set());
    expect(service.enrich({ network: { ip: '10.0.0.1' } })).toEqual({});
    expect(service.enrich({ network: { ip: 'not an ip' } })).toEqual({});
    expect(service.enrich({})).toEqual({});
    expect(lookup).not.toHaveBeenCalled();
    const off = new EnrichmentService(NO_GEOIP, new Set());
    expect(off.geolocation).toBe(false);
    expect(off.enrich({ network: { ip: '8.8.8.8' } })).toEqual({});
  });

  it('says at boot what it loaded', () => {
    new EnrichmentService(geoip, new Set([1, 2])).onApplicationBootstrap();
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      'IP geolocation on: database built 12 days ago, 2 hosting ASNs',
    );
    new EnrichmentService(NO_GEOIP, new Set()).onApplicationBootstrap();
    expect(Logger.prototype.log).toHaveBeenCalledTimes(1);
  });
});
