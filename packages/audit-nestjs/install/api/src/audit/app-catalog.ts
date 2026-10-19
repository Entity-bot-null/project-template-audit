import type { ActionSpec } from './contract/index.js';

// This project's own audit actions (docs/audit/connection-guide.md#your-own-actions),
// next to the base catalog of the template's flows (catalog/base-catalog.ts).
// Created by `pnpm connector add` and never overwritten: it is this project's.
// A name is domain.entity.verb; the base catalog's names are taken.
//
//   'billing.invoice.paid': {
//     category: 'audit',
//     severity: 'info',
//     description: 'An invoice was paid.',
//     source: 'server',
//     resourceType: 'invoice',
//     details: { fields: { amountCents: { type: 'integer', min: 0 } } },
//   },
export const APP_ACTIONS = {} satisfies Record<string, ActionSpec>;
