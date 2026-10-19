import { describe, expect, it } from 'vitest';
import { CreateConnectedAppSchema, UpdateConnectedAppSchema } from './connected-app.schemas.js';

// The rules of the request bodies; their 400 answers are covered by
// connected-apps.int.spec.ts.

const app = (overrides: Record<string, unknown> = {}) => ({
  slug: 'my-project',
  name: 'My project',
  environment: 'production',
  ...overrides,
});

const webhookIssues = (webhookUrl: string) => {
  const result = CreateConnectedAppSchema.safeParse(app({ webhookUrl }));
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('CreateConnectedAppSchema', () => {
  it('takes an application without a webhook, and trims its name', () => {
    expect(CreateConnectedAppSchema.parse(app({ name: '  My project ' }))).toEqual(app());
  });

  it('takes a webhook URL that names a path only, over http or https', () => {
    expect(webhookIssues('https://app.example.com/api/audit/webhooks')).toEqual([]);
    expect(webhookIssues('http://localhost:3000/api/audit/webhooks')).toEqual([]);
  });

  it.each([
    ['a query string', 'https://app.example.com/api/audit/webhooks?token=1'],
    ['a fragment', 'https://app.example.com/api/audit/webhooks#part'],
    ['a user name', 'https://admin@app.example.com/api/audit/webhooks'],
    ['a password', 'https://:secret@app.example.com/api/audit/webhooks'],
  ])('refuses a webhook URL with %s: the signature would not cover it', (_case, url) => {
    expect(webhookIssues(url)).toEqual(['no query string, fragment or credentials']);
  });

  it('refuses another scheme and an oversized URL', () => {
    expect(webhookIssues('ftp://app.example.com/webhooks')).not.toEqual([]);
    expect(webhookIssues(`https://app.example.com/${'a'.repeat(2048)}`)).not.toEqual([]);
  });

  it('refuses an environment that is not a short lowercase name', () => {
    expect(CreateConnectedAppSchema.safeParse(app({ environment: 'staging-2' })).success).toBe(
      true,
    );
    expect(CreateConnectedAppSchema.safeParse(app({ environment: 'Production' })).success).toBe(
      false,
    );
    expect(CreateConnectedAppSchema.safeParse(app({ environment: 'a'.repeat(17) })).success).toBe(
      false,
    );
  });
});

describe('UpdateConnectedAppSchema', () => {
  it('takes any one change, and null to remove the webhook', () => {
    expect(UpdateConnectedAppSchema.parse({ status: 'suspended' })).toEqual({
      status: 'suspended',
    });
    expect(UpdateConnectedAppSchema.parse({ webhookUrl: null })).toEqual({ webhookUrl: null });
  });

  it('refuses a body that changes nothing', () => {
    const result = UpdateConnectedAppSchema.safeParse({});
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['nothing to change']);
  });

  it('keeps the limits of each setting', () => {
    expect(UpdateConnectedAppSchema.safeParse({ heartbeatTimeoutSec: 59 }).success).toBe(false);
    expect(UpdateConnectedAppSchema.safeParse({ rateLimitPerMinute: 10_001 }).success).toBe(false);
    expect(
      UpdateConnectedAppSchema.safeParse({ webhookUrl: 'https://app.example.com/?a=1' }).success,
    ).toBe(false);
  });
});
