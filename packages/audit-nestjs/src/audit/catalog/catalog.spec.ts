import { describe, expect, it } from 'vitest';
import { APP_ACTIONS } from '../app-catalog.js';
import { TEST_ACTIONS } from '../audit.testing.js';
import {
  ActionSpecSchema,
  CATALOG_VERSION_PATTERN,
  CatalogDocumentSchema,
  RESPONSE_ACTIONS,
} from '../contract/index.js';
import { BASE_ACTIONS } from './base-catalog.js';
import {
  ACTIONS,
  actionSpec,
  BASE_ACTION_NAMES,
  catalogDocument,
  catalogVersion,
} from './catalog.js';

describe('the catalog', () => {
  it('is a document the contract accepts, with or without response actions', () => {
    expect(
      CatalogDocumentSchema.safeParse(catalogDocument('shop', '0.1.0', [])).error,
    ).toBeUndefined();
    expect(
      CatalogDocumentSchema.safeParse(catalogDocument('shop', '0.1.0', [...RESPONSE_ACTIONS]))
        .error,
    ).toBeUndefined();
  });

  it('declares every action validly', () => {
    for (const [name, spec] of Object.entries(ACTIONS)) {
      expect(ActionSpecSchema.safeParse(spec).error, name).toBeUndefined();
    }
  });

  it('holds the base actions and the app actions, none of them reusing a base name', () => {
    expect(BASE_ACTION_NAMES).toEqual(Object.keys(BASE_ACTIONS));
    for (const name of Object.keys(APP_ACTIONS)) {
      expect(BASE_ACTION_NAMES, name).not.toContain(name);
    }
    expect(Object.keys(ACTIONS)).toEqual([...BASE_ACTION_NAMES, ...Object.keys(APP_ACTIONS)]);
  });

  it('names the app and its version, and lists response actions only when there are some', () => {
    const plain = catalogDocument('shop', '0.1.0', []);
    expect(plain.catalogFormat).toBe(1);
    expect(plain.app).toEqual({ name: 'shop', version: '0.1.0' });
    expect('responseActions' in plain).toBe(false);
    expect(plain.actions).toEqual(ACTIONS);

    const actions = ['revoke_sessions', 'disable_account'] as const;
    const responding = catalogDocument('shop', '0.1.0', actions);
    expect(responding.responseActions).toEqual(['revoke_sessions', 'disable_account']);
    expect(responding.responseActions).not.toBe(actions);
  });

  it('copies the actions: a document cannot change the catalog', () => {
    const document = catalogDocument('shop', '0.1.0', []);
    delete document.actions['auth.session.signed_in'];
    expect(actionSpec('auth.session.signed_in')).toBeDefined();
  });
});

describe('actionSpec', () => {
  it("answers the spec of an action of the project's catalog", () => {
    expect(actionSpec('auth.session.signed_in')).toBe(BASE_ACTIONS['auth.session.signed_in']);
    expect(actionSpec('account.email.changed')).toBe(BASE_ACTIONS['account.email.changed']);
  });

  it('answers from the catalog it is given', () => {
    expect(actionSpec('shop.order.placed', TEST_ACTIONS)).toBe(TEST_ACTIONS['shop.order.placed']);
    expect(actionSpec('auth.session.signed_in', TEST_ACTIONS)).toBeUndefined();
  });

  it('answers nothing for an unknown action or a property of every object', () => {
    for (const name of ['test.unknown.action', 'toString', '__proto__', 'constructor']) {
      expect(actionSpec(name), name).toBeUndefined();
      expect(actionSpec(name, TEST_ACTIONS), name).toBeUndefined();
    }
  });
});

describe('catalogVersion', () => {
  it('is the same for the same document', () => {
    const version = catalogVersion(catalogDocument('shop', '0.1.0', ['revoke_sessions']));
    expect(version).toMatch(CATALOG_VERSION_PATTERN);
    expect(catalogVersion(catalogDocument('shop', '0.1.0', ['revoke_sessions']))).toBe(version);
  });

  it('changes with the actions, the app or the response actions', () => {
    const document = catalogDocument('shop', '0.1.0', []);
    const version = catalogVersion(document);
    const more = {
      ...document,
      actions: { ...document.actions, ...TEST_ACTIONS },
    };
    expect(catalogVersion(more)).not.toBe(version);
    const changed = {
      ...document,
      actions: {
        ...document.actions,
        'auth.sign_up.requested': {
          ...BASE_ACTIONS['auth.sign_up.requested'],
          severity: 'low' as const,
        },
      },
    };
    expect(catalogVersion(changed)).not.toBe(version);
    expect(catalogVersion(catalogDocument('blog', '0.1.0', []))).not.toBe(version);
    expect(catalogVersion(catalogDocument('shop', '0.2.0', []))).not.toBe(version);
    expect(catalogVersion(catalogDocument('shop', '0.1.0', ['revoke_sessions']))).not.toBe(version);
  });
});
