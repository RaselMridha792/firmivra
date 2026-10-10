import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import {
  type DownloadLink,
  ESIGN_OPEN_STATUSES,
  type MySignatureList,
  type MySignatureRow,
  type MySignatureState,
  type MySignaturesStatus,
  type SignerCopyFile,
  type SignerState,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { BUSINESS_MODULES, type BusinessModules } from '../../common/modules/requires-module.js';
import { GET_URL_SECONDS } from '../../storage/document-storage.js';
import { COMPLETION_REPOSITORY } from '../completion/completion.repository.js';
import type { EsignCompletionRepository } from '../completion/completion.repository.js';
import { ESIGN_STORE, type EsignStore } from '../engine/engine.types.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { esignRefusal } from '../requests/requests.service.js';
import { SIGNER_REPOSITORY, type EsignSignerRepository } from '../signer/signer.repository.js';
import { EsignSignerService, linkInvalid } from '../signer/signer.service.js';
import { CENTER_REPOSITORY, type EsignCenterRepository } from './center.repository.js';
import type { MySignatureRecord } from './center.repository.js';

/** A signed-in client login at one firm: both from the session (TenantGuard), never the URL. */
export interface PortalSigner {
  businessId: string;
  clientAccountId: string;
}

const OPEN: readonly string[] = ESIGN_OPEN_STATUSES;
/** A signer whose turn it is. */
const TURN: readonly string[] = ['SENT', 'DELIVERED', 'VIEWED'];
const PENDING: readonly MySignatureState[] = ['ACTION_NEEDED', 'WAITING'];
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * Where the request stands for this login. ACTION_NEEDED: an open, unexpired request whose
 * SIGNER it is, at its turn and not signing in person (that is on a staff device). An open
 * request past its expiry reads EXPIRED before the expiry job marks it.
 */
export function myState(
  { request: q, recipient: me }: MySignatureRecord,
  now: Date,
): MySignatureState {
  if (q.status === 'COMPLETED' || q.status === 'DECLINED' || q.status === 'VOIDED') {
    return q.status;
  }
  if (!OPEN.includes(q.status) || (q.expiresAt !== null && q.expiresAt <= now)) return 'EXPIRED';
  const mine = me.kind === 'SIGNER' && TURN.includes(me.status) && me.delivery !== 'IN_PERSON';
  return mine ? 'ACTION_NEEDED' : 'WAITING';
}

/**
 * The portal's Signature center (R13 step 9): a signed-in client login's own requests, signing
 * one from the portal (the portal sign-in is the check: no email or access code) and the
 * completed files. Only the login's own recipients, never another household login's or
 * client's (404). The audit log gets ids only.
 */
@Injectable()
export class EsignCenterService {
  constructor(
    @Inject(CENTER_REPOSITORY) private readonly repo: EsignCenterRepository,
    @Inject(BUSINESS_MODULES) private readonly modules: BusinessModules,
    @Inject(ESIGN_DIRECTORY) private readonly directory: Pick<EsignDirectory, 'member' | 'firm'>,
    @Inject(SIGNER_REPOSITORY) private readonly signers: Pick<EsignSignerRepository, 'signer'>,
    @Inject(EsignSignerService) private readonly signer: Pick<EsignSignerService, 'openFromPortal'>,
    @Inject(COMPLETION_REPOSITORY)
    private readonly completed: Pick<EsignCompletionRepository, 'files'>,
    @Inject(ESIGN_STORE) private readonly store: Pick<EsignStore, 'presignDownload'>,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  /** Never off as an error: `{ enabled: false }`. */
  async status(businessId: string): Promise<MySignaturesStatus> {
    return { enabled: await this.modules.isEnabled(businessId, 'esign') };
  }

  async list(p: PortalSigner, tab: 'PENDING' | 'SIGNED'): Promise<MySignatureList> {
    const now = new Date();
    const names = new Map<string, Promise<string>>();
    const senderName = (userId: string) => {
      if (!names.has(userId)) {
        const name = this.directory.member(p.businessId, userId).then((m) => m?.name ?? '');
        names.set(userId, name);
      }
      return names.get(userId)!;
    };
    const rows = await Promise.all(
      (await this.repo.mine(p.businessId, p.clientAccountId)).map(
        async (r): Promise<MySignatureRow> => ({
          recipientId: r.recipient.id,
          title: r.request.title,
          senderName: await senderName(r.request.senderUserId),
          state: myState(r, now),
          sentAt: (r.request.sentAt ?? r.request.createdAt).toISOString(),
          expiresAt: PENDING.includes(myState(r, now)) ? iso(r.request.expiresAt) : null,
          signedAt: iso(r.recipient.signedAt),
          completedAt: iso(r.request.completedAt),
        }),
      ),
    );
    const items = rows.filter((r) => PENDING.includes(r.state) === (tab === 'PENDING'));
    await this.audit.log(
      'esign.my_signatures_listed',
      { type: 'client_account', id: p.clientAccountId },
      { tab, recipientIds: items.map((r) => r.recipientId) },
    );
    return { items };
  }

  /** Opens an ACTION_NEEDED request's signer pages; anything else is LINK_INVALID. */
  async startSigning(p: PortalSigner, recipientId: string, res: Response): Promise<SignerState> {
    const found = await this.repo.one(p.businessId, p.clientAccountId, recipientId);
    if (!found) throw notFound();
    if (myState(found, new Date()) !== 'ACTION_NEEDED') throw linkInvalid();
    const record = await this.signers.signer(p.businessId, found.request.id, recipientId);
    if (!record) throw linkInvalid();
    const { name, slug } = await this.directory.firm(p.businessId);
    return this.signer.openFromPortal({ id: p.businessId, slug, name }, record, res);
  }

  /** A COMPLETED request's signed PDF or certificate: a 5-minute link. */
  async download(
    p: PortalSigner,
    recipientId: string,
    file: SignerCopyFile,
  ): Promise<DownloadLink> {
    const found = await this.repo.one(p.businessId, p.clientAccountId, recipientId);
    if (!found) throw notFound();
    const q = found.request;
    const files = q.status === 'COMPLETED' ? await this.completed.files(p.businessId, q.id) : null;
    if (!files) throw esignRefusal('INVALID_STATE');
    const { key, fileName } = files[file];
    const contentType = 'application/pdf';
    const url = await this.store.presignDownload(p.businessId, { key, fileName, contentType });
    await this.audit.log(
      'esign.my_signature_downloaded',
      { type: 'esign_recipient', id: recipientId },
      { requestId: q.id, clientAccountId: p.clientAccountId, file },
    );
    return { url, expiresAt: new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString() };
  }
}
