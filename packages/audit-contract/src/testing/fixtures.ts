import type { CatalogDocument } from '../catalog.js';

// Valid examples of the contract's documents, for specs here and in Audit Hub.

export * from './events.js';

export function catalog(overrides: Partial<CatalogDocument> = {}): CatalogDocument {
  return {
    catalogFormat: 1,
    app: { name: 'my-project', version: '1.4.2' },
    responseActions: ['revoke_sessions'],
    actions: {
      'auth.session.signed_in': {
        category: 'security',
        severity: 'info',
        description: 'A user signed in with their email and password.',
        source: 'server',
        outcomes: ['success'],
        tags: ['auth.sign_in'],
        resourceType: 'session',
        userVisible: true,
        details: {
          fields: {
            method: { type: 'enum', values: ['password', 'invitation', 'sign_up'], required: true },
            mfa: { type: 'boolean' },
          },
        },
      },
      'account.profile.updated': {
        category: 'audit',
        severity: 'low',
        description: 'A user changed their name.',
        source: 'server',
        change: { fields: { name: { type: 'string', personal: true } } },
      },
      'client.session.expired': {
        category: 'security',
        severity: 'low',
        description: 'The app found its session expired.',
        source: 'client',
      },
    },
    ...overrides,
  };
}
