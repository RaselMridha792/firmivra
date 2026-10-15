import { Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { InjectDatabase, toRecipient, toRequest } from '../requests/esign-prisma.js';
import type { EsignCenterRepository, MySignatureRecord } from './center.repository.js';

/**
 * The portal's Signature center in PostgreSQL (R13, r0_esign): the signed-in login's own SIGNER
 * and CC recipients on sent requests, in the firm's scope. The login comes from the session.
 */
@Injectable()
export class PrismaCenterRepository implements EsignCenterRepository {
  constructor(@InjectDatabase() private readonly database: Database) {}

  private async find(businessId: string, clientAccountId: string, recipientId?: string) {
    const rows = await this.database.forBusiness(businessId).esignRecipient.findMany({
      where: {
        ...(recipientId && { id: recipientId }),
        linkType: 'CLIENT_LOGIN',
        clientAccountId,
        kind: { in: ['SIGNER', 'CC'] },
        request: { sentAt: { not: null } },
      },
      include: { request: true },
      orderBy: [{ request: { sentAt: 'desc' } }, { id: 'asc' }],
    });
    return rows.map(({ request, ...recipient }): MySignatureRecord => ({
      request: toRequest(request),
      recipient: toRecipient(recipient),
    }));
  }

  mine(businessId: string, clientAccountId: string): Promise<MySignatureRecord[]> {
    return this.find(businessId, clientAccountId);
  }

  async one(businessId: string, clientAccountId: string, recipientId: string) {
    return (await this.find(businessId, clientAccountId, recipientId))[0] ?? null;
  }
}
