import { ConflictException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import {
  type EsignAccessRole,
  type EsignApprovalBody,
  type EsignApproverList,
  ESIGN_ERRORS,
  type EsignRequestDetail,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { EsignStaffEvent } from '../../notify/notify.types.js';
import {
  errorName,
  EsignLifecycleService,
  event,
  type Outgoing,
} from '../lifecycle/lifecycle.service.js';
import {
  type DirectoryMember,
  ESIGN_DIRECTORY,
  type EsignDirectory,
} from '../requests/esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignRecipientRecord,
  type EsignRepository,
  type EsignRequestRecord,
} from '../requests/esign.repository.js';
import { EsignPrepareService } from '../requests/prepare.service.js';
import {
  type EsignActor,
  EsignRequestsService,
  esignRefusal,
  readOnly,
} from '../requests/requests.service.js';
import { EsignSendService } from '../requests/send.service.js';
import { type EsignExtrasRepository, EXTRAS_REPOSITORY } from './extras.repository.js';

const APPROVER_ROLES: readonly EsignAccessRole[] = ['OWNER', 'ADMIN', 'MANAGER'];
const entity = (id: string) => ({ type: 'esign_request', id });
const notAnApprover = () =>
  new ForbiddenException({ code: 'NOT_AN_APPROVER', message: ESIGN_ERRORS.NOT_AN_APPROVER });

/**
 * Approvals (R13, contract 3, extras.ts). Submitting is a write on a DRAFT (the sender, the
 * client's assigned member, Owner, Admin): its only readiness problem must be APPROVAL_PENDING,
 * and its approvers are emailed. Deciding is open to the request's APPROVER recipients only, who
 * reach it for that whatever the client assignment (403 NOT_AN_APPROVER for anyone else who
 * reaches it, or an approver who may no longer approve). The last approval sends it in the
 * sender's name; if that fails, the approvals stand, it stays a DRAFT and the sender is emailed.
 * A rejection (with a note) puts it back to DRAFT and the sender is emailed. Notes never go in an
 * email, a log or the audit.
 */
@Injectable()
export class EsignApprovalsService {
  private readonly logger = new Logger(EsignApprovalsService.name);

  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(EsignPrepareService) private readonly prepare: Pick<EsignPrepareService, 'check'>,
    @Inject(EsignSendService) private readonly sender: Pick<EsignSendService, 'send'>,
    @Inject(EsignLifecycleService)
    private readonly lifecycle: Pick<EsignLifecycleService, 'deliver' | 'staff'>,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(EXTRAS_REPOSITORY) private readonly extras: EsignExtrasRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_BASE_URL'>,
  ) {}

  async submit(businessId: string, actor: EsignActor, id: string): Promise<EsignRequestDetail> {
    const record = await this.requests.draft(businessId, actor, id);
    const parts = await this.repo.parts(businessId, id);
    const { problems } = await this.prepare.check(businessId, actor, record, parts);
    // Approvals that still stand (a send that failed) need no new round: it is sent instead.
    const pendingOnly = problems.length > 0 && problems.every((p) => p.code === 'APPROVAL_PENDING');
    if (!pendingOnly) {
      const message = ESIGN_ERRORS.NOT_READY;
      throw new ConflictException({ code: 'NOT_READY', message, details: problems });
    }
    const approvers = parts.recipients.filter((r) => r.kind === 'APPROVER');
    for (const r of approvers) {
      if (!(await this.mayApprove(businessId, record, r))) {
        throw esignRefusal('APPROVER_NOT_ALLOWED');
      }
    }
    const now = new Date();
    const by = await this.lifecycle.staff(businessId, actor);
    const name = by.kind === 'STAFF' ? by.name : '';
    const link = this.workspace(id);
    const outgoing = approvers.flatMap((r): Outgoing[] => {
      if (!r.email) return [];
      const template = 'esign.approval-requested' as const;
      const data = { name: r.name, title: record.title, senderName: name, link };
      return [
        {
          email: { recipientId: r.id, template },
          message: { template, to: r.email, businessId, data },
        },
      ];
    });
    const write = {
      at: now,
      events: [event('APPROVAL_REQUESTED', now, by, null)],
      emails: outgoing.map((o) => o.email),
    };
    const written = await this.extras.submitForApproval(
      businessId,
      id,
      write,
      record.lastActivityAt,
    );
    if (!written) throw esignRefusal('INVALID_STATE');
    await this.audit.log('esign.approval_requested', entity(id), {
      clientId: record.clientId,
      recipientIds: approvers.map((r) => r.id),
      emailIds: written.emailIds,
    });
    await this.lifecycle.deliver(businessId, written.emailIds, outgoing);
    return this.requests.answer(businessId, written.request);
  }

  async decide(
    businessId: string,
    actor: EsignActor,
    id: string,
    body: z.output<typeof EsignApprovalBody>,
  ): Promise<EsignRequestDetail> {
    const reached = await this.requests.reach(businessId, actor, id, 'read');
    const { record } = reached;
    const parts = reached.parts ?? (await this.repo.parts(businessId, id));
    const me = parts.recipients.find(
      (r) => r.kind === 'APPROVER' && r.link.type === 'STAFF' && r.link.userId === actor.userId,
    );
    if (!me || !(await this.mayApprove(businessId, record, me))) throw notAnApprover();
    if (record.status !== 'NEEDS_APPROVAL') throw esignRefusal('INVALID_STATE');
    if (me.status === 'APPROVED') throw esignRefusal('RECIPIENT_DONE');
    const approve = body.decision === 'APPROVE';
    const last =
      approve &&
      parts.recipients.every(
        (r) => r.kind !== 'APPROVER' || r.id === me.id || r.status === 'APPROVED',
      );
    const now = new Date();
    const by = await this.lifecycle.staff(businessId, actor);
    const sender = await this.directory.member(businessId, record.senderUserId);
    const outgoing = approve
      ? []
      : this.toSender(businessId, record, sender, 'APPROVAL_REJECTED', me.name);
    const write = {
      at: now,
      recipientId: me.id,
      decision: body.decision,
      note: body.note ?? null,
      last,
      events: [event(approve ? 'APPROVED' : 'APPROVAL_REJECTED', now, by, me)],
      emails: outgoing.map((o) => o.email),
    };
    const written = await this.extras.decideApproval(businessId, id, write, record.lastActivityAt);
    if (!written) throw esignRefusal('INVALID_STATE');
    await this.audit.log('esign.approval_decided', entity(id), {
      clientId: record.clientId,
      recipientId: me.id,
      decision: body.decision,
      emailIds: written.emailIds,
    });
    await this.lifecycle.deliver(businessId, written.emailIds, outgoing);
    if (!last) return this.requests.answer(businessId, written.request);
    return this.sendApproved(businessId, written.request, sender);
  }

  /** GET /esign/approvers: active Owners, Admins and Managers but the caller; a Viewer 403. */
  async approvers(businessId: string, actor: EsignActor): Promise<EsignApproverList> {
    readOnly(actor);
    const [members, roles] = await Promise.all([
      this.directory.members(businessId),
      this.extras.staffRoles(businessId),
    ]);
    return {
      items: members.flatMap((m) => {
        const role = m.firmRole === 'STAFF' ? roles.get(m.userId) : m.firmRole;
        if (
          m.userId === actor.userId ||
          (role !== 'MANAGER' && role !== 'OWNER' && role !== 'ADMIN')
        ) {
          return [];
        }
        return [{ user: { userId: m.userId, name: m.name }, esignRole: role }];
      }),
    };
  }

  /** A STAFF approver, not the sender, an active Owner, Admin or Firm Sign Manager now. */
  private async mayApprove(
    businessId: string,
    record: EsignRequestRecord,
    r: EsignRecipientRecord,
  ) {
    if (r.link.type !== 'STAFF' || r.link.userId === record.senderUserId) return false;
    const [role, member] = await Promise.all([
      this.repo.esignRole(businessId, r.link.userId),
      this.directory.member(businessId, r.link.userId),
    ]);
    return !!member?.active && role !== null && APPROVER_ROLES.includes(role);
  }

  /** Sends it as its sender would; on any failure it stays a DRAFT and the sender is told. */
  private async sendApproved(
    businessId: string,
    record: EsignRequestRecord,
    sender: DirectoryMember | null,
  ): Promise<EsignRequestDetail> {
    try {
      const role = await this.repo.esignRole(businessId, record.senderUserId);
      if (!role || !sender?.active) throw esignRefusal('NOT_A_MEMBER');
      return await this.sender.send(businessId, { userId: record.senderUserId, role }, record.id);
    } catch (error) {
      this.logger.warn(`esign request ${record.id}: approved but not sent (${errorName(error)})`);
      const outgoing = this.toSender(businessId, record, sender, 'APPROVED', null);
      const emails = outgoing.map((o) => o.email);
      const emailIds = emails.length
        ? await this.extras.queueEmails(businessId, record.id, emails)
        : [];
      await this.audit.log('esign.approval_send_failed', entity(record.id), {
        clientId: record.clientId,
        emailIds,
      });
      await this.lifecycle.deliver(businessId, emailIds, outgoing);
      const now = await this.repo.findRequest(businessId, record.id);
      return this.requests.answer(businessId, now ?? record);
    }
  }

  /** The sender's update email (an active sender only); `signerName` is the approver's name. */
  private toSender(
    businessId: string,
    record: EsignRequestRecord,
    sender: DirectoryMember | null,
    kind: EsignStaffEvent,
    signerName: string | null,
  ): Outgoing[] {
    if (!sender?.active) return [];
    const template = 'esign.staff-update' as const;
    const data = {
      name: sender.name,
      title: record.title,
      event: kind,
      signerName,
      link: this.workspace(record.id),
    };
    return [
      {
        email: { userId: sender.userId, template },
        message: {
          template,
          to: sender.email,
          businessId,
          data,
          recipient: { userId: sender.userId },
        },
      },
    ];
  }

  private workspace(id: string) {
    return new URL(`/firm-sign/requests/${id}`, this.env.APP_BASE_URL).toString();
  }
}
