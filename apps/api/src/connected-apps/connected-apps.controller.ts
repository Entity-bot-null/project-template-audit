import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import { Auth } from '../auth/auth.decorator.js';
import { RequireRecentAuth } from '../auth/recent-auth.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors, ZodBody } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import { ConnectedAppsService } from './connected-apps.service.js';
import {
  AppDeletionProgressSchema,
  ConnectedAppSchema,
  type CreateConnectedAppDto,
  CreateConnectedAppSchema,
  CreatedConnectedAppSchema,
  CredentialsSchema,
  type DeleteConnectedAppLogDto,
  DeleteConnectedAppLogSchema,
  type UpdateConnectedAppDto,
  UpdateConnectedAppSchema,
} from './dto/connected-app.schemas.js';

// Administrators register applications and manage their credentials
// (docs/adr/0006). Secrets appear only in the answer that creates them. Every
// change needs a recent step-up and is recorded in Audit Hub's own audit log
// (docs/adr/0012).
@ApiTags('connected-apps')
@Controller('connected-apps')
@Auth('admin')
export class ConnectedAppsController {
  constructor(
    private readonly apps: ConnectedAppsService,
    private readonly hubAudit: HubAuditService,
  ) {}

  private changed(
    admin: RequestUser,
    appId: string,
    change: 'created' | 'updated' | 'key_created' | 'key_revoked' | 'webhook_secret_rotated',
    req: Request,
  ) {
    return this.hubAudit.recordQuietly({
      action: 'hub.app.changed',
      actor: { type: 'user', id: admin.id, role: admin.role },
      resource: { type: 'connected_app', id: appId },
      details: { change },
      request: req,
    });
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Register an application',
    description:
      'Answers the variables the application needs, its signing key secret and pseudonymization key included: shown this once, Audit Hub keeps only ciphertexts. 409: the slug is taken.',
  })
  @ZodBody(CreateConnectedAppSchema)
  @ApiData(CreatedConnectedAppSchema, { status: 201 })
  @ApiErrors(400, 403, 409)
  @RequireRecentAuth()
  async create(
    @CurrentUser() admin: RequestUser,
    @Body() body: CreateConnectedAppDto,
    @Req() req: Request,
  ) {
    const created = await this.apps.create(admin.id, body);
    await this.changed(admin, created.app.id, 'created', req);
    return created;
  }

  @Get()
  @ApiOperation({ summary: 'Connected applications, by name' })
  @ApiData(z.array(ConnectedAppSchema))
  @ApiErrors(403)
  list() {
    return this.apps.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One connected application and its keys' })
  @ApiData(ConnectedAppSchema)
  @ApiErrors(400, 403, 404)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.apps.get(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change an application: name, webhook URL, status, limits, response actions',
  })
  @ZodBody(UpdateConnectedAppSchema)
  @ApiData(ConnectedAppSchema)
  @ApiErrors(400, 403, 404)
  @RequireRecentAuth()
  async update(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateConnectedAppDto,
    @Req() req: Request,
  ) {
    const updated = await this.apps.update(id, body);
    await this.changed(admin, id, 'updated', req);
    return updated;
  }

  @Post(':id/keys')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Rotate the signing key',
    description:
      'A new key, shown once; the current one keeps verifying for 7 days. 409: a replaced key is still valid (revoke it first).',
  })
  @ApiData(CredentialsSchema, { status: 201 })
  @ApiErrors(400, 403, 404, 409)
  @RequireRecentAuth()
  async rotateKey(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.apps.get(id);
    const key = await this.apps.createKey(admin.id, id);
    await this.changed(admin, id, 'key_created', req);
    return { variables: { AUDIT_HUB_KEY_ID: key.keyId, AUDIT_HUB_KEY_SECRET: key.keySecret } };
  }

  @Delete(':id/keys/:keyId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a signing key: its requests are refused at once' })
  @ApiResponse({ status: 204, description: 'Revoked' })
  @ApiErrors(400, 403, 404)
  @RequireRecentAuth()
  async revokeKey(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.apps.revokeKey(id, keyId);
    await this.changed(admin, id, 'key_revoked', req);
  }

  @Post(':id/webhook-secret')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Rotate the webhook secret',
    description: 'A new secret, shown once; deliveries carry both signatures for 7 days.',
  })
  @ApiData(CredentialsSchema, { status: 201 })
  @ApiErrors(400, 403, 404)
  @RequireRecentAuth()
  async rotateWebhookSecret(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const rotated = await this.apps.rotateWebhookSecret(id);
    await this.changed(admin, id, 'webhook_secret_rotated', req);
    return rotated;
  }

  @Post(':id/deletion')
  @HttpCode(200)
  @ApiOperation({
    summary: "Delete a suspended application's audit log at the end of its service, and retire it",
    description:
      "Deletes its events for at most 10 seconds a call, then, once none is left, what Audit Hub derived from them (alerts, response actions, what the rules remember, its keys), and retires the application: its seals, catalog and the records of the deletion stay, so the verification still passes. Never what a legal hold keeps. Confirm with the application's slug. Status deleting or waiting (events not sealed yet, 2 minutes): call again. 409: the application is not suspended.",
  })
  @ZodBody(DeleteConnectedAppLogSchema)
  @ApiData(AppDeletionProgressSchema)
  @ApiErrors(400, 403, 404, 409)
  @RequireRecentAuth()
  async deleteLog(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeleteConnectedAppLogDto,
    @Req() req: Request,
  ) {
    const { progress, retired } = await this.apps.deleteLog(id, body.confirm);
    if (retired) {
      await this.hubAudit.recordQuietly({
        action: 'hub.app.deleted',
        actor: { type: 'user', id: admin.id, role: admin.role },
        resource: { type: 'connected_app', id },
        details: { eventsDeleted: await this.apps.deletedEvents(id) },
        request: req,
      });
    }
    return progress;
  }
}
