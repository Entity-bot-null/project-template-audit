import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../common/types/request-user.js';
import type { HubAuditService, HubEventInput } from '../hub-audit/hub-audit.service.js';
import { ConnectedAppsController } from './connected-apps.controller.js';
import type { ConnectedAppsService } from './connected-apps.service.js';
import type { AppDeletionProgress } from './dto/connected-app.schemas.js';

// The routes themselves are wiring (connected-apps.int.spec.ts); here, what
// the end of an application's service records in Audit Hub's own log.

const APP = '0199e0b1-0000-7000-8000-000000000001';
const ADMIN: RequestUser = { id: '0199e0b1-0000-7000-8000-00000000000a', role: 'admin' };
const REQ = { ip: '203.0.113.7' } as Request;

function setup(answer: { progress: AppDeletionProgress; retired: boolean }) {
  const apps = {
    deleteLog: vi.fn((_id: string, _confirm: string) => Promise.resolve(answer)),
    deletedEvents: vi.fn((_id: string) => Promise.resolve(5003)),
  };
  const hubAudit = { recordQuietly: vi.fn((_input: HubEventInput) => Promise.resolve()) };
  const controller = new ConnectedAppsController(
    apps as unknown as ConnectedAppsService,
    hubAudit as unknown as HubAuditService,
  );
  return { apps, hubAudit, controller };
}

describe('ConnectedAppsController', () => {
  describe('deleteLog', () => {
    it('records hub.app.deleted with every event deleted when the call retired the application', async () => {
      const progress: AppDeletionProgress = { status: 'deleted', deleted: 3, held: 0, waiting: 0 };
      const { apps, hubAudit, controller } = setup({ progress, retired: true });
      await expect(
        controller.deleteLog(ADMIN, APP, { confirm: 'my-project' }, REQ),
      ).resolves.toEqual(progress);
      expect(apps.deleteLog).toHaveBeenCalledWith(APP, 'my-project');
      // Over every call of the deletion, not only this last one.
      expect(apps.deletedEvents).toHaveBeenCalledWith(APP);
      expect(hubAudit.recordQuietly).toHaveBeenCalledTimes(1);
      expect(hubAudit.recordQuietly).toHaveBeenCalledWith({
        action: 'hub.app.deleted',
        actor: { type: 'user', id: ADMIN.id, role: 'admin' },
        resource: { type: 'connected_app', id: APP },
        details: { eventsDeleted: 5003 },
        request: REQ,
      });
    });

    it('records nothing while the deletion goes on, is held, or was finished by an earlier call', async () => {
      const answers: { progress: AppDeletionProgress; retired: boolean }[] = [
        { progress: { status: 'deleting', deleted: 5000, held: 0, waiting: 0 }, retired: false },
        { progress: { status: 'waiting', deleted: 0, held: 0, waiting: 4 }, retired: false },
        { progress: { status: 'held', deleted: 0, held: 2, waiting: 0 }, retired: false },
        // Retired already: answered as deleted, recorded by the call that retired it.
        { progress: { status: 'deleted', deleted: 0, held: 0, waiting: 0 }, retired: false },
      ];
      for (const answer of answers) {
        const { apps, hubAudit, controller } = setup(answer);
        await expect(
          controller.deleteLog(ADMIN, APP, { confirm: 'my-project' }, REQ),
        ).resolves.toEqual(answer.progress);
        expect(apps.deletedEvents).not.toHaveBeenCalled();
        expect(hubAudit.recordQuietly).not.toHaveBeenCalled();
      }
    });
  });
});
