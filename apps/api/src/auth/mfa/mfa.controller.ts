import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RouteRateLimit } from '../../common/guards/rate-limit.guard.js';
import type { ApiEnvelope } from '../../common/interceptors/transform.interceptor.js';
import { ApiData, ApiErrors, ZodBody } from '../../common/openapi/index.js';
import type { RequestUser } from '../../common/types/request-user.js';
import { Auth } from '../auth.decorator.js';
import { type AuthSession, AuthSessionSchema } from '../dto/auth.schemas.js';
import { RequireRecentAuth } from '../recent-auth.js';
import { refreshTokenOf, respondWithSession } from '../session-cookies.js';
import {
  type EnrolledSession,
  EnrolledSessionSchema,
  type MfaEnrollConfirmDto,
  MfaEnrollConfirmSchema,
  MfaEnrollmentSchema,
  MfaEnrollStartSchema,
  MfaResetSchema,
  MfaStatusSchema,
  type MfaVerifyDto,
  MfaVerifySchema,
  RecoveryCodesSchema,
  type StepUpDto,
  StepUpSchema,
} from './dto/mfa.schemas.js';
import { MFA_RATE_LIMIT } from './mfa.constants.js';
import { MfaService } from './mfa.service.js';

// The second factor's step of a sign-in (docs/adr/0012): under /api/auth, where
// the web app sends no access token and the refresh cookie travels. The
// challenge token from sign-in (or from a confirmed sign-up or invitation) is
// the credential; the session starts here.
@ApiTags('auth')
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Post('verify')
  @HttpCode(200)
  @RouteRateLimit(MFA_RATE_LIMIT)
  @ApiOperation({
    summary: 'Finish signing in with a code from the authenticator app, or a recovery code',
    description:
      "Starts the session like the template's sign-in did (refresh cookie, access token). A recovery code works once and sends a notice by email. 401: the code is wrong or used (5 attempts per challenge), or the challenge expired or was used: sign in again. 403: the account may no longer use the panel (docs/security.md#who-may-sign-in).",
  })
  @ZodBody(MfaVerifySchema)
  @ApiData(AuthSessionSchema)
  @ApiErrors(400, 401, 403)
  async verify(
    @Body() body: MfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiEnvelope<AuthSession>> {
    const result = await this.mfa.verify(
      body.challengeToken,
      {
        ...(body.code === undefined ? {} : { code: body.code }),
        ...(body.recoveryCode === undefined ? {} : { recoveryCode: body.recoveryCode }),
      },
      req,
      refreshTokenOf(req),
    );
    return respondWithSession(res, result, 'Signed in');
  }

  @Post('enroll')
  @HttpCode(200)
  @RouteRateLimit(MFA_RATE_LIMIT)
  @ApiOperation({
    summary: 'Start setting up the second factor: a new secret, as a QR and as text',
    description:
      'For a challenge with mfa: enroll. Each call makes a new secret; the last one is the one a code confirms. 401: the challenge expired or was used. 409: a factor is set up already.',
  })
  @ZodBody(MfaEnrollStartSchema)
  @ApiData(MfaEnrollmentSchema)
  @ApiErrors(400, 401, 403, 409)
  enroll(@Body() body: z.infer<typeof MfaEnrollStartSchema>) {
    return this.mfa.startEnrollment(body.challengeToken);
  }

  @Post('enroll/confirm')
  @HttpCode(200)
  @RouteRateLimit(MFA_RATE_LIMIT)
  @ApiOperation({
    summary: 'Confirm the new second factor with a code: the session starts',
    description:
      'Answers the session and ten recovery codes, shown this once. 401: the code is wrong (5 attempts per challenge) or the challenge expired. 403: the account may not use the panel (docs/security.md#who-may-sign-in): nothing is set up, and no session starts. 409: start the set-up again.',
  })
  @ZodBody(MfaEnrollConfirmSchema)
  @ApiData(EnrolledSessionSchema)
  @ApiErrors(400, 401, 403, 409)
  async confirm(
    @Body() body: MfaEnrollConfirmDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiEnvelope<EnrolledSession>> {
    const { recoveryCodes, ...result } = await this.mfa.confirmEnrollment(
      body.challengeToken,
      body.code,
      req,
      refreshTokenOf(req),
    );
    respondWithSession(res, result, 'Second factor set up');
    return { data: { ...result.session, recoveryCodes }, message: 'Second factor set up' };
  }
}

// The signed-in person's own second factor, and the step-up: under
// /api/account, where the web app sends the access token.
@ApiTags('account')
@Controller('account')
@Auth()
export class AccountMfaController {
  constructor(private readonly mfa: MfaService) {}

  @Post('step-up')
  @HttpCode(200)
  @RouteRateLimit(MFA_RATE_LIMIT)
  @ApiOperation({
    summary: 'Confirm the password and a code again, for a sensitive action',
    description:
      'Answers a new access token that allows sensitive actions for 5 minutes (exports, keys, response actions, legal holds, retention, roles, resetting a second factor). It is not carried over by a refresh. 403: the password or the code is wrong.',
  })
  @ZodBody(StepUpSchema)
  @ApiData(AuthSessionSchema)
  @ApiErrors(400, 403)
  stepUp(@CurrentUser() user: RequestUser, @Body() body: StepUpDto, @Req() req: Request) {
    return this.mfa.stepUp(user, body.password, body.code, req);
  }

  @Get('mfa')
  @ApiOperation({ summary: 'The second factor of the account: since when, recovery codes left' })
  @ApiData(MfaStatusSchema)
  status(@CurrentUser() user: RequestUser) {
    return this.mfa.status(user.id);
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @RequireRecentAuth()
  @ApiOperation({
    summary: 'Replace the recovery codes (after a step-up)',
    description: 'Ten new codes, shown this once; the old ones stop working.',
  })
  @ApiData(RecoveryCodesSchema)
  @ApiErrors(403)
  async recoveryCodes(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return { recoveryCodes: await this.mfa.regenerateRecoveryCodes(user, req) };
  }
}

// An administrator resets someone's second factor (a lost phone, no
// recovery codes left): after a step-up, with a reason.
@ApiTags('users')
@Controller('users')
@Auth('admin')
export class MfaAdminController {
  constructor(private readonly mfa: MfaService) {}

  @Post(':id/mfa-reset')
  @HttpCode(204)
  @RequireRecentAuth()
  @ApiOperation({
    summary: "Reset a person's second factor; they set up a new one at their next sign-in",
    description:
      'Every session of theirs ends; they get a notice by email. 403: no recent step-up, or your own account (use a recovery code). 404: no such user. 409: a removed account.',
  })
  @ZodBody(MfaResetSchema)
  @ApiResponse({ status: 204, description: 'Reset' })
  @ApiErrors(400, 403, 404, 409)
  async reset(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: z.infer<typeof MfaResetSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.mfa.reset(admin, id, body.reason, req);
  }
}
