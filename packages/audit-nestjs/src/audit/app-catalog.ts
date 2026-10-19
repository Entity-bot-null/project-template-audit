import type { ActionSpec } from './contract/index.js';

// TEST DOUBLE of the project's app-catalog.ts (install/api/audit/app-catalog.ts):
// empty, like a new project's. The connector's specs never rely on a
// project's own actions: the ones they need are in audit.testing.ts
// (TEST_ACTIONS), passed to what takes a catalog.
export const APP_ACTIONS = {} satisfies Record<string, ActionSpec>;
