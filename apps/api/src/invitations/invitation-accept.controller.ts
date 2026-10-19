import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { INVITATION_ACCEPT_RATE_LIMIT } from '../auth/auth.constants.js';
import { type InvitationAcceptDto, InvitationAcceptSchema } from '../auth/dto/auth.schemas.js';
import { type MfaChallengeResponse, MfaChallengeSchema } from '../auth/mfa/dto/mfa.schemas.js';
import { RouteRateLimit } from '../common/guards/rate-limit.guard.js';
import type { ApiEnvelope } from '../common/interceptors/transform.interceptor.js';
import { ApiData, ApiErrors, ZodBody } from '../common/openapi/index.js';
import { InvitationsService } from './invitations.service.js';

// The invitation's link, opened from the invited mailbox in a browser that
// is not signed in (or is, as someone else): the token is the credential.
// Under /api/auth, where the web app sends no access token. Cross-site
// requests never reach it: the global Fetch Metadata guard refuses them.
@ApiTags('auth')
@Controller('auth/invitations')
export class InvitationAcceptController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('accept')
  @HttpCode(200)
  @RouteRateLimit(INVITATION_ACCEPT_RATE_LIMIT)
  @ApiOperation({
    summary: "Accept an invitation with its link's token, choosing a name and a password",
    description:
      "Creates the account with the invitation's role and applications, and answers a challenge to set up its second factor (mfa: enroll): the session starts once it is confirmed (docs/adr/0012). 400: the password is refused (too short, too common, too easy to guess, or containing the email or name); the link still works. 404: the invitation is invalid, replaced, revoked, used or expired, or no longer opens the panel (its applications were retired, or it invites a member). 409: the address got an account meanwhile.",
  })
  @ZodBody(InvitationAcceptSchema)
  @ApiData(MfaChallengeSchema)
  @ApiErrors(400, 403, 404, 409)
  async accept(@Body() body: InvitationAcceptDto): Promise<ApiEnvelope<MfaChallengeResponse>> {
    const challenge = await this.invitations.accept(body.token, body.name, body.password);
    return { data: challenge, message: 'Invitation accepted' };
  }
}
