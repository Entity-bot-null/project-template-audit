import { SDK } from './audit.constants';
import { countingRandom, NOW, TEST_FACTS } from './audit.testing';
import { ClientSchema, DEVICE_ID_PATTERN } from './contract';
import { clientInfoOf, locationOf, networkTypeOf, newDeviceId, requestHeadersOf } from './device';

describe("the phone's facts", () => {
  it('fill the client section of an event, as the contract has it', () => {
    const client = clientInfoOf(
      { ...TEST_FACTS, updateId: '0199F0C4-0000-7000-8000-00000000A001' },
      { deviceId: 'install-0001', networkType: 'CELLULAR', route: '/(app)/items/[id]' },
    );
    expect(client).toEqual({
      type: 'android',
      appVersion: '1.4.2',
      appBuild: '42',
      updateId: '0199f0c4-0000-7000-8000-00000000a001',
      os: 'Android',
      osVersion: '15',
      deviceModel: 'Pixel 9',
      deviceId: 'install-0001',
      locale: 'es-MX',
      timeZone: 'America/Mexico_City',
      networkType: 'cellular',
      route: '/(app)/items/[id]',
      sdk: { name: SDK.name, version: SDK.version },
    });
    expect(ClientSchema.safeParse(client).success).toBe(true);
  });

  it('leave out what does not fit the contract, and cut long names safely', () => {
    const client = clientInfoOf(
      {
        platform: 'web',
        appVersion: '1.4.2 (beta)',
        appBuild: null,
        updateId: 'not-a-uuid',
        os: '  ',
        osVersion: null,
        deviceModel: `${'x'.repeat(63)}😀 Pro`,
        locale: 'not a locale',
        timeZone: null,
      },
      { deviceId: 'short', route: '/items/42?tab=1' },
    );
    expect(client).toEqual({
      type: 'web',
      deviceModel: `${'x'.repeat(63)}�`,
      sdk: { name: SDK.name, version: SDK.version },
    });
    expect(ClientSchema.safeParse(client).success).toBe(true);
    expect(
      clientInfoOf({ ...TEST_FACTS, platform: 'ios' }, { deviceId: 'install-0001' }).type,
    ).toBe('ios');
  });

  it('name the network as the contract does', () => {
    expect(
      ['WIFI', 'CELLULAR', 'ETHERNET', 'VPN', 'NONE', 'UNKNOWN', 'BLUETOOTH', 'WIMAX', 'OTHER'].map(
        networkTypeOf,
      ),
    ).toEqual([
      'wifi',
      'cellular',
      'ethernet',
      'vpn',
      'none',
      'unknown',
      'other',
      'other',
      'other',
    ]);
    expect(networkTypeOf(null)).toBeUndefined();
  });

  it('give every request its version, platform and installation', () => {
    expect(requestHeadersOf(TEST_FACTS, 'install-0001')).toEqual({
      'X-App-Platform': 'android',
      'X-App-Version': '1.4.2',
      'X-App-Build': '42',
      'X-Device-Id': 'install-0001',
    });
    expect(
      requestHeadersOf({ ...TEST_FACTS, appVersion: null, appBuild: null, platform: 'ios' }, '?'),
    ).toEqual({ 'X-App-Platform': 'ios' });
  });

  it('make installation ids of 128 random bits', () => {
    const random = countingRandom();
    const first = newDeviceId(random);
    expect(first).toBe('0102030405060708090a0b0c0d0e0f10');
    expect(newDeviceId(random)).not.toBe(first);
    expect(DEVICE_ID_PATTERN.test(first)).toBe(true);
  });
});

describe('a position', () => {
  const at = (minutesAgo: number) => NOW - minutesAgo * 60_000;

  it('is rounded to 0.01° on the device, claiming no better than a kilometre', () => {
    expect(
      locationOf(
        { latitude: 19.43261, longitude: -99.13321, accuracyM: 35, capturedAt: at(2) },
        NOW,
      ),
    ).toEqual({
      latitude: 19.43,
      longitude: -99.13,
      accuracyM: 1000,
      capturedAt: new Date(at(2)).toISOString(),
    });
    expect(
      locationOf({ latitude: -0.001, longitude: 0.004, accuracyM: 5400.6, capturedAt: at(0) }, NOW),
    ).toEqual({
      latitude: 0,
      longitude: 0,
      accuracyM: 5401,
      capturedAt: new Date(NOW).toISOString(),
    });
    for (const accuracyM of [null, 0, -1, Number.NaN]) {
      expect(
        locationOf({ latitude: 40.4168, longitude: -3.7038, accuracyM, capturedAt: at(1) }, NOW)
          ?.accuracyM,
      ).toBe(1000);
    }
  });

  it('keeps five decimals and its accuracy when the person allowed the precise position', () => {
    const fix = { latitude: 19.4326081, longitude: -99.1332093, capturedAt: at(0) };
    expect(locationOf({ ...fix, accuracyM: 4.6 }, NOW, true)).toEqual({
      latitude: 19.43261,
      longitude: -99.13321,
      accuracyM: 5,
      capturedAt: new Date(NOW).toISOString(),
    });
    expect(locationOf({ ...fix, accuracyM: 0.3 }, NOW, true)?.accuracyM).toBe(1);
    // Measured worse than a kilometre, or unknown: approximate after all.
    expect(locationOf({ ...fix, accuracyM: 1500 }, NOW, true)).toMatchObject({
      latitude: 19.43,
      accuracyM: 1500,
    });
    expect(locationOf({ ...fix, accuracyM: null }, NOW, true)).toMatchObject({
      latitude: 19.43,
      accuracyM: 1000,
    });
    // Without the precise permission, a good fix is still rounded.
    expect(locationOf({ ...fix, accuracyM: 4.6 }, NOW)?.latitude).toBe(19.43);
  });

  it('is left out when old, from the future, vague or not a position', () => {
    const place = { latitude: 40.4168, longitude: -3.7038, accuracyM: 20 };
    for (const position of [
      { ...place, capturedAt: at(31) },
      { ...place, capturedAt: NOW + 1 },
      { ...place, capturedAt: at(1), accuracyM: 150_000 },
      { ...place, capturedAt: at(1), latitude: 91 },
      { ...place, capturedAt: at(1), longitude: -181 },
      { ...place, capturedAt: at(1), latitude: Number.NaN },
      { ...place, capturedAt: Number.NaN },
    ]) {
      expect(locationOf(position, NOW)).toBeUndefined();
    }
  });
});
