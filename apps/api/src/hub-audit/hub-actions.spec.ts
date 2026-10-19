import { ACTION_PATTERN, ActionSpecSchema, TAGS } from 'audit-contract';
import { describe, expect, it } from 'vitest';
import { HUB_ACTIONS, hubActionsTagged, hubTagsOf } from './hub-actions.js';

describe('HUB_ACTIONS', () => {
  it('is a valid catalog: every action validates like an application one', () => {
    for (const [name, entry] of Object.entries(HUB_ACTIONS)) {
      expect(name).toMatch(/^hub\./);
      expect(name).toMatch(ACTION_PATTERN);
      expect(ActionSpecSchema.safeParse(entry.spec).success, name).toBe(true);
      expect(entry.spec.source).toBe('server');
    }
  });

  it('validates audit_access actions as audit, and stores them in their own stream', () => {
    expect(HUB_ACTIONS['hub.export.created']).toMatchObject({
      category: 'audit_access',
      spec: { category: 'audit' },
    });
    expect(HUB_ACTIONS['hub.user.role_changed']).toMatchObject({
      category: 'audit',
      spec: { category: 'audit' },
    });
    expect(HUB_ACTIONS['hub.session.signed_in']).toMatchObject({
      category: 'security',
      spec: { category: 'security' },
    });
  });
});

describe('hubActionsTagged', () => {
  it('answers the actions that carry a tag, for the rules', () => {
    expect(hubActionsTagged('auth.sign_in_failed')).toEqual(['hub.session.sign_in_failed']);
    expect(hubActionsTagged('auth.credential_changed').sort()).toEqual([
      'hub.mfa.enrolled',
      'hub.mfa.recovery_codes_regenerated',
      'hub.mfa.reset',
    ]);
    expect(hubActionsTagged('data.bulk_export')).toEqual(['hub.export.created']);
  });

  it('answers none for a tag no action carries', () => {
    expect(hubActionsTagged('data.bulk_delete')).toEqual([]);
  });

  it('agrees with hubTagsOf for every tag', () => {
    for (const tag of TAGS) {
      for (const name of hubActionsTagged(tag)) expect(hubTagsOf(name)).toContain(tag);
    }
  });
});

describe('hubTagsOf', () => {
  it("answers an action's tags, as a copy the caller may change", () => {
    const tags = hubTagsOf('hub.mfa.recovery_code_used');
    expect(tags).toEqual(['auth.recovery']);
    tags.push('auth.sign_in');
    expect(hubTagsOf('hub.mfa.recovery_code_used')).toEqual(['auth.recovery']);
  });

  it('answers none for an action without tags', () => {
    expect(hubTagsOf('hub.session.stepped_up')).toEqual([]);
  });

  it('answers none for any other action, such as an application one', () => {
    expect(hubTagsOf('auth.session.signed_in')).toEqual([]);
    expect(hubTagsOf('hub.unknown.action')).toEqual([]);
    // A name every object answers to is not one of the actions.
    expect(hubTagsOf('toString')).toEqual([]);
    expect(hubTagsOf('__proto__')).toEqual([]);
  });
});
