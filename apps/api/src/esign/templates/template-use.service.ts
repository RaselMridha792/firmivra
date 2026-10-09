import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  ESIGN_ERRORS,
  EsignPutRecipientsBody,
  type EsignRequestDetail,
  type EsignTemplateRole,
  type UseEsignTemplateBody,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import {
  CODE_HASHER,
  type CodeHasher,
  ESIGN_STORE,
  type EsignStore,
} from '../engine/engine.types.js';
import { event } from '../lifecycle/lifecycle.service.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import type { EsignRecipientRecord } from '../requests/esign.repository.js';
import {
  type EsignActor,
  EsignRequestsService,
  esignRefusal,
  invalid,
} from '../requests/requests.service.js';
import { EsignTemplateCopyService, settingsOf } from './template-copy.service.js';
import {
  type EsignTemplateRepository,
  type EsignTemplateVersionRecord,
  TEMPLATE_REPOSITORY,
} from './templates.repository.js';
import { EsignTemplatesService, forbidden } from './templates.service.js';

type Fill = z.output<typeof UseEsignTemplateBody>['roles'][number];
/** The portal login that fills a role by itself. */
const LOGIN_FOR: Partial<Record<EsignTemplateRole['role'], string>> = {
  CLIENT: 'PRIMARY',
  SPOUSE: 'SPOUSE',
};
const NOT_SENT = {
  ...{ sentAt: null, expiresAt: null, completedAt: null, originalSha256: null },
  ...{ expiredAt: null, voidedAt: null, voidReason: null, voidedByUserId: null },
  ...{ replacesRequestId: null, replacedByRequestId: null, expiryWarnedAt: null },
};

/** 409 TEMPLATE_ROLES_UNFILLED naming each role still open (use and bulk send). */
export const rolesUnfilled = (keys: string[]) =>
  new ConflictException({
    code: 'TEMPLATE_ROLES_UNFILLED',
    message: ESIGN_ERRORS.TEMPLATE_ROLES_UNFILLED,
    details: keys.map((key) => ({ path: `roles.${key}`, message: 'Choose who fills it' })),
  });

/**
 * POST /esign/templates/{id}/use (R13 step 9): a new DRAFT (source TEMPLATE) from the newest
 * version, sent by the caller; the template never changes. CLIENT, SPOUSE and PREPARER roles fill
 * themselves (the client's ACTIVE PRIMARY and SPOUSE logins, the caller); `roles` fills the others
 * and sets delivery and access codes (EsignTemplateRoleFill). Every fill is checked (400, 409
 * TEMPLATE_ROLES_UNFILLED, LOGIN_NOT_ACTIVE, NOT_A_MEMBER, APPROVER_NOT_ALLOWED) before anything is
 * written, and the DRAFT is then written at once, so a refusal leaves no DRAFT and no file.
 */
@Injectable()
export class EsignTemplateUseService {
  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(EsignTemplatesService) private readonly templateAccess: EsignTemplatesService,
    @Inject(EsignTemplateCopyService) private readonly copies: EsignTemplateCopyService,
    @Inject(TEMPLATE_REPOSITORY) private readonly templates: EsignTemplateRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(ESIGN_STORE) private readonly store: Pick<EsignStore, 'keyFor' | 'put'>,
    @Inject(CODE_HASHER) private readonly codes: Pick<CodeHasher, 'hash'>,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  async use(
    businessId: string,
    actor: EsignActor,
    templateId: string,
    body: z.output<typeof UseEsignTemplateBody>,
  ): Promise<EsignRequestDetail> {
    const t = await this.templateAccess.reach(businessId, actor, templateId);
    if (actor.role === 'VIEWER') throw forbidden();
    if (t.archivedAt) throw esignRefusal('TEMPLATE_ARCHIVED');
    const v = await this.templateAccess.current(businessId, t);
    const client = body.clientId
      ? await this.requests.reachableClient(businessId, actor, body.clientId)
      : null;
    const clientId = client?.id ?? null;
    const service = body.engagementId ?? null;
    const engagementId = await this.requests.openService(businessId, clientId, service);
    const recipients = await this.recipients(businessId, actor, clientId, v, body.roles);
    const bytes = await this.copies.packet(businessId, v);
    const [id, docId, now] = [randomUUID(), randomUUID(), new Date()];
    const s3Key = this.store.keyFor(businessId, id, `source/${docId}`);
    const roleOf = new Map(v.roles.map((role, i) => [role.key, recipients[i]!.id]));
    const caller = await this.directory.member(businessId, actor.userId);
    const record = {
      ...settingsOf(v),
      ...NOT_SENT,
      id,
      title: body.title ?? t.name,
      status: 'DRAFT' as const,
      source: 'TEMPLATE' as const,
      clientId,
      engagementId,
      senderUserId: actor.userId,
      internalNote: null,
      createdAt: now,
      lastActivityAt: now,
      template: { id: t.id, version: t.version },
    };
    const document = {
      id: docId,
      position: 0,
      fileName: `${t.name}.pdf`,
      contentType: 'application/pdf' as const,
      sizeBytes: bytes.byteLength,
      pageCount: v.pageSizes.length,
      pageSizes: v.pageSizes,
      sourceDocumentId: null,
      scanStatus: 'CLEAN' as const,
      createdAt: now,
      s3Key,
      sha256: v.sha256,
    };
    const parts = {
      documents: [document],
      pagePlan: v.pageSizes.map((_, page) => ({ documentId: docId, page, rotation: 0 as const })),
      recipients,
      fields: v.fields.map(({ roleKey, ...f }) => ({
        ...f,
        id: randomUUID(),
        recipientId: roleKey === null ? null : (roleOf.get(roleKey) ?? null),
        filled: false,
      })),
    };
    const created = event('CREATED', now, { kind: 'STAFF', name: caller?.name ?? '' }, null);
    await this.store.put(businessId, s3Key, bytes, 'application/pdf');
    const written = await this.copies.removingOnFailure(businessId, s3Key, () =>
      this.templates.createDraft(businessId, { record, parts, event: created }),
    );
    await this.audit.log(
      'esign.request_created',
      { type: 'esign_request', id },
      { clientId, engagementId, source: 'TEMPLATE', templateId: t.id, templateVersion: t.version },
    );
    return this.requests.answer(businessId, written);
  }

  /** Who fills each role (the fills, else CLIENT, SPOUSE and PREPARER fill themselves). */
  private async recipients(
    businessId: string,
    actor: EsignActor,
    clientId: string | null,
    v: EsignTemplateVersionRecord,
    fills: Fill[],
  ): Promise<EsignRecipientRecord[]> {
    fills.forEach((f, i) => {
      if (!v.roles.some((r) => r.key === f.key)) {
        throw invalid(`roles.${i}.key`, 'This role is not in the template');
      }
    });
    const fillOf = new Map(fills.map((f) => [f.key, f]));
    const logins = clientId ? await this.directory.clientLogins(businessId, clientId) : [];
    const auto = (role: EsignTemplateRole) => {
      const portalRole = LOGIN_FOR[role.role];
      const l = logins.find((x) => x.portalRole === portalRole && x.status === 'ACTIVE');
      if (l) return { type: 'CLIENT_LOGIN' as const, clientAccountId: l.id };
      return role.role === 'PREPARER' ? { type: 'STAFF' as const, userId: actor.userId } : null;
    };
    const open: string[] = [];
    const inputs = v.roles.map((role) => {
      const fill = fillOf.get(role.key);
      const who = fill?.who ?? auto(role);
      const authMethod = fill?.authMethod ?? role.authMethod;
      const code = authMethod === 'ACCESS_CODE' ? fill?.accessCode : undefined;
      if (!who || (authMethod === 'ACCESS_CODE' && fill?.delivery !== 'IN_PERSON' && !code)) {
        open.push(role.key);
      }
      const { kind, role: r, roleLabel, routingOrder } = role;
      return {
        ...{ kind, role: r, routingOrder, who, delivery: fill?.delivery, authMethod },
        ...(roleLabel !== null && { roleLabel }),
        ...(code !== undefined && { accessCode: code }),
      };
    });
    if (open.length > 0) throw rolesUnfilled(open);
    // EsignPutRecipient's rules, with the role's key in the path (400).
    const parsed = EsignPutRecipientsBody.safeParse({ recipients: inputs });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const [, i, ...rest] = issue.path;
      const key = typeof i === 'number' ? v.roles[i]?.key : undefined;
      const path = ['roles', key, ...rest].filter((x) => x !== undefined).join('.');
      throw invalid(path, issue.message);
    }
    const sender = { senderUserId: actor.userId };
    const out: EsignRecipientRecord[] = [];
    for (const [i, input] of parsed.data.recipients.entries()) {
      const id = randomUUID();
      const who = await this.requests.who(businessId, clientId, input.who);
      if (input.kind === 'APPROVER') await this.requests.approver(businessId, sender, input.who);
      const coded = input.authMethod === 'ACCESS_CODE' && input.delivery !== 'IN_PERSON';
      out.push({
        ...who,
        id,
        kind: input.kind,
        role: input.role,
        roleLabel: input.role === 'CUSTOM' ? (input.roleLabel ?? null) : null,
        routingOrder: v.routing === 'PARALLEL' ? 1 : input.routingOrder,
        delivery: input.delivery,
        authMethod: input.authMethod,
        accessCodeHash: coded ? this.codes.hash(id, 'ACCESS', input.accessCode!) : null,
        colorIndex: v.roles[i]!.colorIndex,
        status: 'WAITING',
        ...{ sentAt: null, viewedAt: null, signedAt: null, declinedAt: null },
        ...{ declineReason: null, lastRemindedAt: null, reminderCount: 0 },
      });
    }
    return out;
  }
}
