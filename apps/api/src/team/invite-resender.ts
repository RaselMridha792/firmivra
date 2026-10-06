import { Injectable, ServiceUnavailableException } from '@nestjs/common';
export interface TeamInviteResend {
  businessId: string;
  membershipId: string;
  actorUserId: string;
}
/** Rasel's adapter must atomically recheck actor/INVITED target, revoke/create, and enqueue delivery. */
export abstract class InviteResender {
  abstract resend(input: TeamInviteResend): Promise<void>;
}
@Injectable()
export class PendingInviteResender extends InviteResender {
  resend(): Promise<void> {
    throw new ServiceUnavailableException({
      code: 'INTEGRATION_NOT_READY',
      message: 'Invite delivery integration is not available',
    });
  }
}
