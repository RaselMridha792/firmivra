import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  type EsignField,
  type EsignFieldType,
  EsignMergeKey,
  type EsignMergeValues,
  type EsignPutFieldsBody,
  type EsignReadiness,
  type EsignRequestDetail,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ESIGN_RULES, type EsignRules } from '../engine/engine.types.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from './esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignRepository,
  type EsignRequestRecord,
} from './esign.repository.js';
import { type EsignActor, EsignRequestsService, invalid, seesAll } from './requests.service.js';

/**
 * The sender's field types that may take a merge value: the text-like ones. A checkbox, radio
 * button or dropdown has no free text to fill (the contract has no list of its own yet).
 */
const MERGE_FIELD_TYPES = new Set<EsignFieldType>([
  'TEXT',
  'PRINTED_NAME',
  'EMAIL',
  'PHONE',
  'ADDRESS',
]);
const entity = (id: string) => ({ type: 'esign_request', id });
type MergeRow = Record<EsignMergeKey, string | null>;

/** The day in the firm's time zone ("October 9, 2026"), as the mock and emails show dates. */
function today(timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: zone }).format(new Date());
  try {
    return format(timeZone);
  } catch {
    return format('UTC'); // an unknown zone name
  }
}

/**
 * A DRAFT's fields, its merge values and its readiness (R13 step 6, part 2a). Access is the
 * requests service's (404 for what the caller may not see; field writes on DRAFTs only). The
 * audit log gets ids and counts only, never a field's value or label.
 */
@Injectable()
export class EsignPrepareService {
  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(ESIGN_RULES) private readonly rules: Pick<EsignRules, 'readiness'>,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  /** The whole list. Kept ids stay; an unknown id, a non-signer or a page off the plan is 400. */
  async putFields(
    businessId: string,
    actor: EsignActor,
    id: string,
    body: z.output<typeof EsignPutFieldsBody>,
  ): Promise<EsignRequestDetail> {
    await this.requests.draft(businessId, actor, id);
    const parts = await this.repo.parts(businessId, id);
    const known = new Set(parts.fields.map((f) => f.id));
    const signers = new Set(parts.recipients.filter((r) => r.kind === 'SIGNER').map((r) => r.id));
    const fields = body.fields.map((f, i): EsignField => {
      const refuse = (path: string, message: string) => invalid(`fields.${i}.${path}`, message);
      if (f.id !== undefined && !known.has(f.id)) {
        throw refuse('id', 'This field is not on the request');
      }
      if (f.recipientId !== null && !signers.has(f.recipientId)) {
        throw refuse('recipientId', 'Assign the field to one of the signers');
      }
      if (f.pageIndex >= parts.pagePlan.length) {
        throw refuse('pageIndex', 'This page is not in the packet');
      }
      if (f.mergeKey !== undefined && !MERGE_FIELD_TYPES.has(f.type)) {
        throw refuse('mergeKey', 'This type of field can’t take a merge field');
      }
      return {
        id: f.id ?? randomUUID(),
        recipientId: f.recipientId,
        type: f.type,
        pageIndex: f.pageIndex,
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        required: f.required,
        label: f.label ?? null,
        mergeKey: f.mergeKey ?? null,
        options: f.options,
        groupKey: f.groupKey ?? null,
        value: f.value ?? null,
        filled: false,
      };
    });
    await this.requests.drafted(this.repo.saveFields(businessId, id, fields));
    const kept = new Set(fields.map((f) => f.id));
    await this.audit.log('esign.fields_updated', entity(id), {
      fieldCount: fields.length,
      fieldsRemoved: parts.fields.filter((f) => !kept.has(f.id)).length,
    });
    return this.requests.get(businessId, actor, id);
  }

  async mergeValues(businessId: string, actor: EsignActor, id: string): Promise<EsignMergeValues> {
    const record = await this.requests.reach(businessId, actor, id);
    const { fields } = await this.repo.parts(businessId, id);
    return this.merge(businessId, actor, record, fields);
  }

  /** The rules' readiness check, plus APPROVER_MISSING (below). */
  async readiness(businessId: string, actor: EsignActor, id: string): Promise<EsignReadiness> {
    const record = await this.requests.reach(businessId, actor, id);
    const parts = await this.repo.parts(businessId, id);
    const [merge, defaults, consentPublished] = await Promise.all([
      this.merge(businessId, actor, record, parts.fields),
      this.repo.defaults(businessId),
      this.repo.consentPublished(businessId),
    ]);
    const result = this.rules.readiness({
      documents: parts.documents,
      clientId: record.clientId,
      engagementId: record.engagementId,
      recipients: parts.recipients.map((r) => ({ ...r, hasAccessCode: r.accessCodeHash !== null })),
      // R18 follow-up: readiness() counts a required sender field (no recipient; it has a value
      // or a merge key) as SIGNATURE_UNASSIGNED. The sender fills those, so they go in as optional.
      fields: parts.fields.map((f) => (f.recipientId ? f : { ...f, required: false })),
      missingMergeKeys: merge.missing,
      expiryDays: record.expiryDays,
      reminders: record.reminders,
      consentPublished,
    });
    // R18 follow-up: ReadinessInput has no `approvalRequired` yet, so Signing Settings'
    // requireApproval is checked here until EsignRules.readiness takes it.
    if (defaults.requireApproval && !parts.recipients.some((r) => r.kind === 'APPROVER')) {
      result.problems.push({
        code: 'APPROVER_MISSING',
        recipientId: null,
        fieldId: null,
        documentId: null,
        mergeKey: null,
      });
      result.ready = false;
    }
    return result;
  }

  /**
   * The 17 values: the client's only while the caller may still see the client (Owner, Admin, or
   * the member it is assigned to), the sender's from the directory, the firm's from its profile.
   * `missing`: the keys the fields use that have no value.
   */
  private async merge(
    businessId: string,
    actor: EsignActor,
    record: EsignRequestRecord,
    fields: Pick<EsignField, 'mergeKey'>[],
  ): Promise<EsignMergeValues> {
    const [client, firm, staff] = await Promise.all([
      record.clientId ? this.directory.client(businessId, record.clientId) : null,
      this.directory.firm(businessId),
      this.directory.member(businessId, record.senderUserId),
    ]);
    const sees = client && (seesAll(actor) || client.assignedUserId === actor.userId);
    const c = sees ? await this.directory.clientContact(businessId, client.id) : null;
    const fullName = c && ([c.firstName, c.lastName].filter(Boolean).join(' ') || c.displayName);
    const business = c && (c.businessName ?? (c.accountType === 'BUSINESS' ? c.displayName : null));
    const values: MergeRow = {
      CLIENT_FIRST_NAME: c?.firstName ?? null,
      CLIENT_LAST_NAME: c?.lastName ?? null,
      CLIENT_FULL_NAME: fullName,
      CLIENT_EMAIL: c?.email ?? null,
      CLIENT_PHONE: c?.phone ?? null,
      CLIENT_ADDRESS: c?.address ?? null,
      BUSINESS_NAME: business,
      SPOUSE_NAME: c?.spouseName ?? null,
      STAFF_NAME: staff?.name ?? null,
      STAFF_TITLE: staff?.jobTitle ?? null,
      STAFF_EMAIL: staff?.email ?? null,
      STAFF_PHONE: staff?.phone ?? null,
      FIRM_NAME: firm.name,
      FIRM_ADDRESS: firm.address,
      FIRM_PHONE: firm.phone,
      FIRM_EMAIL: firm.email,
      CURRENT_DATE: today(firm.timeZone),
    };
    const used = new Set(fields.map((f) => f.mergeKey));
    const missing = EsignMergeKey.options.filter((k) => used.has(k) && !values[k]);
    return { values, missing };
  }
}
