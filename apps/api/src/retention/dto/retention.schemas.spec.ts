import { describe, expect, it } from 'vitest';
import { CreateLegalHoldSchema, SetRetentionPolicySchema } from './retention.schemas.js';

// The rules of the request bodies; their 400 answers are covered by
// retention.int.spec.ts.

const APP = '0199e0b1-0000-7000-8000-000000000001';
const hold = (criteria: Record<string, unknown>) => ({
  appId: APP,
  caseRef: 'CASE-42',
  reason: 'Litigation with a former employee',
  ...criteria,
});

function issues(input: unknown): { path: string; message: string }[] {
  const result = CreateLegalHoldSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

describe('CreateLegalHoldSchema', () => {
  it.each([
    ['a subject', { actorId: 'user-9' }],
    ['an email', { actorEmail: 'jane@example.com' }],
    ['a resource with its type', { resourceType: 'invoice', resourceId: 'inv-1' }],
    ['a start', { fromAt: '2026-01-01T00:00:00.000Z' }],
    ['an end', { toAt: '2026-12-31T00:00:00.000Z' }],
    ['a period', { fromAt: '2026-01-01T00:00:00.000Z', toAt: '2026-12-31T00:00:00.000Z' }],
  ])('accepts a hold that names %s', (_case, criteria) => {
    expect(issues(hold(criteria))).toEqual([]);
  });

  it('trims the case and the reason', () => {
    const parsed = CreateLegalHoldSchema.parse(
      hold({
        caseRef: '  CASE-42 ',
        reason: '  Litigation with a former employee  ',
        actorId: 'u',
      }),
    );
    expect(parsed).toMatchObject({
      caseRef: 'CASE-42',
      reason: 'Litigation with a former employee',
    });
  });

  it('refuses a hold that keeps nothing in particular', () => {
    expect(issues(hold({}))).toEqual([
      {
        path: '',
        message: 'name what the hold keeps: a subject, an email, a resource or a period',
      },
    ]);
    // A type alone names no resource.
    expect(issues(hold({ resourceType: 'invoice' }))).toHaveLength(1);
  });

  it('refuses a resource id without its type', () => {
    expect(issues(hold({ resourceId: 'inv-1' }))).toEqual([
      { path: 'resourceType', message: 'a resource id needs its type' },
    ]);
  });

  it('refuses a period that ends before it starts, or as it starts', () => {
    const at = '2026-06-01T00:00:00.000Z';
    expect(issues(hold({ fromAt: '2026-12-31T00:00:00.000Z', toAt: at }))).toEqual([
      { path: 'toAt', message: 'must be after fromAt' },
    ]);
    expect(issues(hold({ fromAt: at, toAt: at }))).toEqual([
      { path: 'toAt', message: 'must be after fromAt' },
    ]);
  });

  it('compares the period as instants, whatever the fractional digits', () => {
    expect(
      issues(hold({ fromAt: '2026-10-15T10:00:00Z', toAt: '2026-10-15T10:00:00.500Z' })),
    ).toEqual([]);
    expect(
      issues(hold({ fromAt: '2026-10-15T10:00:00.999Z', toAt: '2026-10-15T10:00:00Z' })),
    ).toEqual([{ path: 'toAt', message: 'must be after fromAt' }]);
  });

  it('checks the email as an address, after trimming', () => {
    expect(issues(hold({ actorEmail: '  jane@example.com ' }))).toEqual([]);
    expect(issues(hold({ actorEmail: 'not-an-address' })).map((issue) => issue.path)).toEqual([
      'actorEmail',
    ]);
  });
});

describe('SetRetentionPolicySchema', () => {
  it('takes from 1 day to 10 years, in whole days', () => {
    expect(SetRetentionPolicySchema.safeParse({ days: 1 }).success).toBe(true);
    expect(SetRetentionPolicySchema.safeParse({ days: 3650 }).success).toBe(true);
    expect(SetRetentionPolicySchema.safeParse({ days: 0 }).success).toBe(false);
    expect(SetRetentionPolicySchema.safeParse({ days: 3651 }).success).toBe(false);
    expect(SetRetentionPolicySchema.safeParse({ days: 1.5 }).success).toBe(false);
  });
});
