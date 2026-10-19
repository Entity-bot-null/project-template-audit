import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AUDIT_ENV_SHAPE, auditConfigFromEnv, checkAuditEnv } from './audit-env.js';

// The project's env schema, as the connection guide tells it to declare the
// connector's variables.
const EnvObject = z.object({
  ...AUDIT_ENV_SHAPE,
  NODE_ENV: z.string().default('development'),
  APP_RELEASE: z.string().optional(),
});
const EnvSchema = EnvObject.superRefine((values, ctx) => {
  checkAuditEnv(values, ctx);
});

const secret = (fill: number) => Buffer.alloc(32, fill).toString('base64url');

const CONNECTION = {
  AUDIT_HUB_URL: 'https://audit.example.com',
  AUDIT_HUB_APP: 'shop',
  AUDIT_HUB_KEY_ID: '0199e0b1-0000-7000-8000-0000000000a1',
  AUDIT_HUB_KEY_SECRET: secret(1),
  AUDIT_HUB_PSEUDONYM_KEY: secret(2),
};

function issues(input: Record<string, string>) {
  const result = EnvSchema.safeParse(input);
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function parse(input: Record<string, string>) {
  return EnvSchema.parse(input);
}

describe('AUDIT_ENV_SHAPE and checkAuditEnv', () => {
  it('leaves the connector off when nothing is set, with the defaults', () => {
    expect(parse({})).toEqual({
      NODE_ENV: 'development',
      AUDIT_HUB_RESPONSE_ACTIONS: [],
      AUDIT_HUB_QUEUE_ALERT: 10_000,
    });
  });

  it('reads empty strings as unset', () => {
    const env = parse({
      AUDIT_HUB_URL: '',
      AUDIT_HUB_APP: '',
      AUDIT_HUB_KEY_ID: '',
      AUDIT_HUB_KEY_SECRET: '',
      AUDIT_HUB_PSEUDONYM_KEY: '',
      AUDIT_HUB_WEBHOOK_SECRET: '',
      AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS: '',
      AUDIT_HUB_RESPONSE_ACTIONS: '',
      AUDIT_HUB_QUEUE_ALERT: '',
    });
    expect(env.AUDIT_HUB_URL).toBeUndefined();
    expect(env.AUDIT_HUB_KEY_SECRET).toBeUndefined();
    expect(env.AUDIT_HUB_WEBHOOK_SECRET).toBeUndefined();
    expect(env.AUDIT_HUB_RESPONSE_ACTIONS).toEqual([]);
    expect(env.AUDIT_HUB_QUEUE_ALERT).toBe(10_000);
    expect(auditConfigFromEnv(env)).toBeNull();
  });

  it('accepts a complete connection', () => {
    const env = parse({ ...CONNECTION, AUDIT_HUB_QUEUE_ALERT: '500' });
    expect(env).toMatchObject(CONNECTION);
    expect(env.AUDIT_HUB_QUEUE_ALERT).toBe(500);
  });

  it('asks for every missing variable of a partial connection', () => {
    const found = issues({ AUDIT_HUB_URL: CONNECTION.AUDIT_HUB_URL, AUDIT_HUB_APP: 'shop' });
    expect(found.map((issue) => issue.path)).toEqual([
      'AUDIT_HUB_KEY_ID',
      'AUDIT_HUB_KEY_SECRET',
      'AUDIT_HUB_PSEUDONYM_KEY',
    ]);
    for (const issue of found) {
      expect(issue.message).toMatch(/^required with AUDIT_HUB_URL, AUDIT_HUB_APP: /);
      expect(issue.message).toContain('AUDIT_HUB_PSEUDONYM_KEY');
    }
  });

  it('refuses malformed values', () => {
    const found = issues({
      ...CONNECTION,
      AUDIT_HUB_URL: 'ftp://audit.example.com',
      AUDIT_HUB_APP: 'Shop',
      AUDIT_HUB_KEY_ID: 'not-a-uuid',
      AUDIT_HUB_KEY_SECRET: 'too-short',
      AUDIT_HUB_QUEUE_ALERT: '50',
    });
    expect(found.map((issue) => issue.path)).toEqual([
      'AUDIT_HUB_URL',
      'AUDIT_HUB_APP',
      'AUDIT_HUB_KEY_ID',
      'AUDIT_HUB_KEY_SECRET',
      'AUDIT_HUB_QUEUE_ALERT',
    ]);
    expect(found[3]?.message).toBe('must be the base64url secret Audit Hub showed');
  });

  it('wants an origin: requests are signed with their path', () => {
    expect(
      parse({ ...CONNECTION, AUDIT_HUB_URL: 'https://audit.example.com/' }).AUDIT_HUB_URL,
    ).toBe('https://audit.example.com/');
    expect(
      parse({ ...CONNECTION, AUDIT_HUB_URL: 'https://audit.example.com:8443' }).AUDIT_HUB_URL,
    ).toBe('https://audit.example.com:8443');
    for (const url of ['https://audit.example.com/hub', 'https://audit.example.com/?a=1']) {
      expect(issues({ ...CONNECTION, AUDIT_HUB_URL: url })).toEqual([
        {
          path: 'AUDIT_HUB_URL',
          message: 'must be an origin (scheme://host[:port]): requests are signed with their path',
        },
      ]);
    }
  });

  it('refuses http in production, except on the loopback', () => {
    expect(
      issues({ ...CONNECTION, AUDIT_HUB_URL: 'http://audit.example.com', NODE_ENV: 'production' }),
    ).toEqual([{ path: 'AUDIT_HUB_URL', message: 'must be https in production' }]);
    for (const url of ['http://localhost:4000', 'http://127.0.0.1', 'http://[::1]:4000']) {
      expect(
        EnvSchema.safeParse({ ...CONNECTION, AUDIT_HUB_URL: url, NODE_ENV: 'production' }).success,
      ).toBe(true);
    }
    expect(
      EnvSchema.safeParse({ ...CONNECTION, AUDIT_HUB_URL: 'http://audit.example.com' }).success,
    ).toBe(true);
    expect(EnvSchema.safeParse({ ...CONNECTION, NODE_ENV: 'production' }).success).toBe(true);
  });

  it('wants the previous webhook secret to differ from the current one', () => {
    expect(
      issues({
        ...CONNECTION,
        AUDIT_HUB_WEBHOOK_SECRET: secret(3),
        AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS: secret(3),
      }),
    ).toEqual([
      {
        path: 'AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS',
        message: 'must differ from AUDIT_HUB_WEBHOOK_SECRET',
      },
    ]);
  });

  it('wants the webhook secret with a previous secret or response actions', () => {
    expect(
      issues({
        ...CONNECTION,
        AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS: secret(4),
        AUDIT_HUB_RESPONSE_ACTIONS: 'revoke_sessions',
      }),
    ).toEqual([
      {
        path: 'AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS',
        message: 'requires AUDIT_HUB_WEBHOOK_SECRET: Audit Hub asks through signed webhooks',
      },
      {
        path: 'AUDIT_HUB_RESPONSE_ACTIONS',
        message: 'requires AUDIT_HUB_WEBHOOK_SECRET: Audit Hub asks through signed webhooks',
      },
    ]);
    expect(
      parse({
        ...CONNECTION,
        AUDIT_HUB_WEBHOOK_SECRET: secret(3),
        AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS: secret(4),
        AUDIT_HUB_RESPONSE_ACTIONS: 'revoke_sessions',
      }).AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS,
    ).toBe(secret(4));
  });

  it('wants the webhook secret with the push module, and the module with its access token', () => {
    expect(issues({ ...CONNECTION, AUDIT_HUB_PUSH: 'expo' })).toEqual([
      {
        path: 'AUDIT_HUB_PUSH',
        message: 'requires AUDIT_HUB_WEBHOOK_SECRET: Audit Hub asks through signed webhooks',
      },
    ]);
    expect(
      issues({
        ...CONNECTION,
        AUDIT_HUB_WEBHOOK_SECRET: secret(3),
        AUDIT_HUB_EXPO_ACCESS_TOKEN: 'expo-access-token_1',
      }),
    ).toEqual([{ path: 'AUDIT_HUB_EXPO_ACCESS_TOKEN', message: 'requires AUDIT_HUB_PUSH=expo' }]);
    for (const value of ['fcm', 'EXPO']) {
      expect(
        issues({ ...CONNECTION, AUDIT_HUB_WEBHOOK_SECRET: secret(3), AUDIT_HUB_PUSH: value }).map(
          (issue) => issue.path,
        ),
      ).toEqual(['AUDIT_HUB_PUSH']);
    }
    expect(
      issues({
        ...CONNECTION,
        AUDIT_HUB_WEBHOOK_SECRET: secret(3),
        AUDIT_HUB_PUSH: 'expo',
        AUDIT_HUB_EXPO_ACCESS_TOKEN: 'has a space',
      }).map((issue) => issue.path),
    ).toEqual(['AUDIT_HUB_EXPO_ACCESS_TOKEN']);
  });

  it('reads the response actions as a comma-separated list', () => {
    const env = parse({
      ...CONNECTION,
      AUDIT_HUB_WEBHOOK_SECRET: secret(3),
      AUDIT_HUB_RESPONSE_ACTIONS: ' revoke_sessions ,, disable_account , ',
    });
    expect(env.AUDIT_HUB_RESPONSE_ACTIONS).toEqual(['revoke_sessions', 'disable_account']);
    expect(
      issues({
        ...CONNECTION,
        AUDIT_HUB_WEBHOOK_SECRET: secret(3),
        AUDIT_HUB_RESPONSE_ACTIONS: 'revoke_sessions,wipe_device',
      }).map((issue) => issue.path),
    ).toEqual(['AUDIT_HUB_RESPONSE_ACTIONS.1']);
    expect(
      issues({
        ...CONNECTION,
        AUDIT_HUB_WEBHOOK_SECRET: secret(3),
        AUDIT_HUB_RESPONSE_ACTIONS:
          'revoke_sessions,require_password_change,disable_account,revoke_sessions',
      }).map((issue) => issue.path),
    ).toEqual(['AUDIT_HUB_RESPONSE_ACTIONS']);
  });
});

describe('auditConfigFromEnv', () => {
  it('is null while any connection variable is missing', () => {
    for (const name of Object.keys(CONNECTION)) {
      // Without the rules between the variables, which would refuse it first.
      expect(auditConfigFromEnv(EnvObject.parse({ ...CONNECTION, [name]: '' }))).toBeNull();
    }
  });

  it('is the connection, with the origin trimmed and the current webhook secret first', () => {
    const config = auditConfigFromEnv(
      parse({
        ...CONNECTION,
        AUDIT_HUB_URL: 'https://audit.example.com/',
        AUDIT_HUB_WEBHOOK_SECRET: secret(3),
        AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS: secret(4),
        AUDIT_HUB_RESPONSE_ACTIONS: 'revoke_sessions',
        AUDIT_HUB_QUEUE_ALERT: '250',
        APP_RELEASE: '2.4.0',
      }),
    );
    expect(config).toEqual({
      hubUrl: 'https://audit.example.com',
      app: 'shop',
      keyId: CONNECTION.AUDIT_HUB_KEY_ID,
      keySecret: CONNECTION.AUDIT_HUB_KEY_SECRET,
      pseudonymKey: CONNECTION.AUDIT_HUB_PSEUDONYM_KEY,
      webhookSecrets: [secret(3), secret(4)],
      responseActions: ['revoke_sessions'],
      queueAlert: 250,
      appVersion: '2.4.0',
      push: null,
    });
  });

  it("turns the push module on with Expo's service, with its access token when given", () => {
    const withWebhooks = { ...CONNECTION, AUDIT_HUB_WEBHOOK_SECRET: secret(3) };
    expect(auditConfigFromEnv(parse({ ...withWebhooks, AUDIT_HUB_PUSH: 'expo' }))?.push).toEqual({
      provider: 'expo',
      accessToken: undefined,
    });
    expect(
      auditConfigFromEnv(
        parse({
          ...withWebhooks,
          AUDIT_HUB_PUSH: 'expo',
          AUDIT_HUB_EXPO_ACCESS_TOKEN: 'expo-access-token_1',
        }),
      )?.push,
    ).toEqual({ provider: 'expo', accessToken: 'expo-access-token_1' });
  });

  it('has no webhook secret and no response action when none is set', () => {
    const config = auditConfigFromEnv(parse(CONNECTION));
    expect(config?.webhookSecrets).toEqual([]);
    expect(config?.responseActions).toEqual([]);
    expect(config?.queueAlert).toBe(10_000);
  });

  it('reports the release as a version token', () => {
    const release = (APP_RELEASE?: string) =>
      auditConfigFromEnv(
        parse({ ...CONNECTION, ...(APP_RELEASE === undefined ? {} : { APP_RELEASE }) }),
      )?.appVersion;
    expect(release()).toBe('unversioned');
    const sha = '3f786850e387550fdab836ed7e6dc881de23001b';
    expect(release(sha)).toBe(sha.slice(0, 32));
    expect(release('v1.0 beta')).toBe('unversioned');
    expect(release('')).toBe('unversioned');
  });
});
