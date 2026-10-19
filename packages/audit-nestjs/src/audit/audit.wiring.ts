import type { ModuleMetadata, Provider } from '@nestjs/common';
import {
  AUDIT_HANDLERS,
  AUDIT_LOCK,
  AUDIT_PUSH,
  AUDIT_STORE,
  AUDIT_TRANSPORT,
} from './audit.constants.js';
import { FakeLock, FakeTransport, MemoryStore } from './audit.testing.js';

// TEST DOUBLE of the project's audit.wiring.ts (install/api/audit/audit.wiring.ts):
// the ports implemented in memory, for the module spec here. A connected
// project wires its own Prisma, LockService and createExternalHttpClient.
export const auditWiring: {
  imports: NonNullable<ModuleMetadata['imports']>;
  providers: Provider[];
} = {
  imports: [],
  providers: [
    { provide: AUDIT_STORE, useValue: new MemoryStore() },
    { provide: AUDIT_TRANSPORT, useValue: new FakeTransport(() => ({ status: 503, body: null })) },
    { provide: AUDIT_LOCK, useValue: new FakeLock() },
    { provide: AUDIT_HANDLERS, useValue: {} },
    { provide: AUDIT_PUSH, useValue: null },
  ],
};
