import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import { DocumentId } from '../documents/schemas.js';
import { TaxReturnId } from './schemas.js';
import {
  AmendTaxReturnRequest,
  ApproveTaxApprovalRequest,
  CarryForwardTaxReturnRequest,
  ChangeTaxReturnStatusRequest,
  CreateTaxApprovalRequest,
  CreateTaxChecklistItemRequest,
  CreateWorkspaceTaxReturnRequest,
  EfileReport,
  EfileReportQuery,
  LinkTaxAuthorizationRequest,
  LinkTaxReturnDocumentRequest,
  PaperFiledRequest,
  RecordTaxFilingAttemptRequest,
  ReturnTaxApprovalRequest,
  SetTaxAuthorizationsRequest,
  SetTaxReturnFilingsRequest,
  TaxApprovalId,
  TaxApprovalList,
  TaxAuthorizationId,
  TaxAuthorizationList,
  TaxChecklist,
  TaxChecklistItemId,
  TaxFilingAttemptId,
  TaxFilingId,
  TaxReturnActivityList,
  TaxReturnDetail,
  TaxReturnDocumentList,
  TaxReturnExportLink,
  TaxReturnFilingList,
  TaxReturnHistoryList,
  TaxReturnPage,
  TaxReturnsQuery,
  TaxReturnSummary,
  TaxReturnSummaryQuery,
  UpdateTaxChecklistItemRequest,
  UpdateTaxFilingAttemptRequest,
  UpdateTaxReturnDetailsRequest,
  UpdateTaxReturnFilingRequest,
  WetSignatureRequest,
} from './workspace.js';

const BASE = '/business/tax-returns';
const ret = (id: string) => `${BASE}/${parseInput(TaxReturnId, id)}`;
const sub = (id: string, part: string, subId: string, schema: typeof TaxReturnId) =>
  `${ret(id)}/${part}/${parseInput(schema, subId)}`;
const post = (body: unknown = {}) => ({ method: 'POST', body });

/**
 * `api.taxReturnWorkspace` (apps/web/src/lib/api.ts): the Tax Returns module (overview, Create
 * New Return, a return's workspace, review, e-file and filing status). R10's `api.taxReturns`
 * stays for a client's Tax Returns tab. Bad input rejects with ApiRequestError(400,
 * 'VALIDATION_FAILED') before anything is sent. No business id is ever sent.
 */
export function createTaxReturnWorkspaceClient(request: ApiRequest) {
  return {
    // Overview
    list: async (query: TaxReturnsQuery = {}): Promise<TaxReturnPage> =>
      request(TaxReturnPage, `${BASE}${toQuery(parseInput(TaxReturnsQuery, query))}`),
    summary: async (query: TaxReturnSummaryQuery = {}): Promise<TaxReturnSummary> =>
      request(
        TaxReturnSummary,
        `${BASE}/summary${toQuery(parseInput(TaxReturnSummaryQuery, query))}`,
      ),
    /** Create New Return. 409 DUPLICATE_RETURN unless `allowDuplicate`. */
    create: async (body: CreateWorkspaceTaxReturnRequest): Promise<TaxReturnDetail> =>
      request(TaxReturnDetail, BASE, post(parseInput(CreateWorkspaceTaxReturnRequest, body))),
    efileReport: async (query: EfileReportQuery = {}): Promise<EfileReport> =>
      request(EfileReport, `${BASE}/reports/efile${toQuery(parseInput(EfileReportQuery, query))}`),
    /** Print/Export List (EXPORT): the filtered list as CSV, masked. */
    exportList: async (query: TaxReturnsQuery = {}): Promise<TaxReturnExportLink> =>
      request(TaxReturnExportLink, `${BASE}/export`, post(parseInput(TaxReturnsQuery, query))),

    // One return
    get: async (id: string): Promise<TaxReturnDetail> => request(TaxReturnDetail, ret(id)),
    updateDetails: async (
      id: string,
      body: UpdateTaxReturnDetailsRequest,
    ): Promise<TaxReturnDetail> =>
      request(TaxReturnDetail, `${ret(id)}/details`, {
        method: 'PATCH',
        body: parseInput(UpdateTaxReturnDetailsRequest, body),
      }),
    /** 409 STATUS_BLOCKED (with `details.blockers`), 400 REASON_REQUIRED going back. */
    changeStatus: async (
      id: string,
      body: ChangeTaxReturnStatusRequest,
    ): Promise<TaxReturnDetail> =>
      request(
        TaxReturnDetail,
        `${ret(id)}/status`,
        post(parseInput(ChangeTaxReturnStatusRequest, body)),
      ),
    history: async (id: string): Promise<TaxReturnHistoryList['items']> =>
      (await request(TaxReturnHistoryList, `${ret(id)}/history`)).items,
    activity: async (id: string): Promise<TaxReturnActivityList['items']> =>
      (await request(TaxReturnActivityList, `${ret(id)}/activity`)).items,
    archive: async (id: string): Promise<TaxReturnDetail> =>
      request(TaxReturnDetail, `${ret(id)}/archive`, post()),
    restore: async (id: string): Promise<TaxReturnDetail> =>
      request(TaxReturnDetail, `${ret(id)}/restore`, post()),
    /** A new return amending this filed one. */
    amend: async (id: string, body: AmendTaxReturnRequest): Promise<TaxReturnDetail> =>
      request(TaxReturnDetail, `${ret(id)}/amend`, post(parseInput(AmendTaxReturnRequest, body))),
    carryForward: async (
      id: string,
      body: CarryForwardTaxReturnRequest,
    ): Promise<TaxReturnDetail> =>
      request(
        TaxReturnDetail,
        `${ret(id)}/carry-forward`,
        post(parseInput(CarryForwardTaxReturnRequest, body)),
      ),

    // Filings and transmissions
    filings: async (id: string): Promise<TaxReturnFilingList['items']> =>
      (await request(TaxReturnFilingList, `${ret(id)}/filings`)).items,
    setFilings: async (
      id: string,
      body: SetTaxReturnFilingsRequest,
    ): Promise<TaxReturnFilingList['items']> =>
      (
        await request(TaxReturnFilingList, `${ret(id)}/filings`, {
          method: 'PUT',
          body: parseInput(SetTaxReturnFilingsRequest, body),
        })
      ).items,
    updateFiling: async (
      id: string,
      filingId: string,
      body: UpdateTaxReturnFilingRequest,
    ): Promise<TaxReturnFilingList['items']> =>
      (
        await request(TaxReturnFilingList, sub(id, 'filings', filingId, TaxFilingId), {
          method: 'PATCH',
          body: parseInput(UpdateTaxReturnFilingRequest, body),
        })
      ).items,
    recordAttempt: async (
      id: string,
      filingId: string,
      body: RecordTaxFilingAttemptRequest,
    ): Promise<TaxReturnFilingList['items']> =>
      (
        await request(
          TaxReturnFilingList,
          `${sub(id, 'filings', filingId, TaxFilingId)}/attempts`,
          post(parseInput(RecordTaxFilingAttemptRequest, body)),
        )
      ).items,
    updateAttempt: async (
      id: string,
      attemptId: string,
      body: UpdateTaxFilingAttemptRequest,
    ): Promise<TaxReturnFilingList['items']> =>
      (
        await request(TaxReturnFilingList, sub(id, 'attempts', attemptId, TaxFilingAttemptId), {
          method: 'PATCH',
          body: parseInput(UpdateTaxFilingAttemptRequest, body),
        })
      ).items,
    paperFiled: async (
      id: string,
      filingId: string,
      body: PaperFiledRequest,
    ): Promise<TaxReturnFilingList['items']> =>
      (
        await request(
          TaxReturnFilingList,
          `${sub(id, 'filings', filingId, TaxFilingId)}/paper-filed`,
          post(parseInput(PaperFiledRequest, body)),
        )
      ).items,

    // Checklists and validation
    checklist: async (id: string): Promise<TaxChecklist['items']> =>
      (await request(TaxChecklist, `${ret(id)}/checklist`)).items,
    addChecklistItem: async (
      id: string,
      body: CreateTaxChecklistItemRequest,
    ): Promise<TaxChecklist['items']> =>
      (
        await request(
          TaxChecklist,
          `${ret(id)}/checklist`,
          post(parseInput(CreateTaxChecklistItemRequest, body)),
        )
      ).items,
    updateChecklistItem: async (
      id: string,
      itemId: string,
      body: UpdateTaxChecklistItemRequest,
    ): Promise<TaxChecklist['items']> =>
      (
        await request(TaxChecklist, sub(id, 'checklist', itemId, TaxChecklistItemId), {
          method: 'PATCH',
          body: parseInput(UpdateTaxChecklistItemRequest, body),
        })
      ).items,
    removeChecklistItem: async (id: string, itemId: string): Promise<TaxChecklist['items']> =>
      (
        await request(TaxChecklist, sub(id, 'checklist', itemId, TaxChecklistItemId), {
          method: 'DELETE',
        })
      ).items,
    /** Run Final Validation: records who ran it and when (no ERROR, warnings acknowledged). */
    finalValidation: async (id: string): Promise<TaxReturnDetail> =>
      request(TaxReturnDetail, `${ret(id)}/final-validation`, post()),

    // Approvals
    approvals: async (id: string): Promise<TaxApprovalList['items']> =>
      (await request(TaxApprovalList, `${ret(id)}/approvals`)).items,
    addApproval: async (
      id: string,
      body: CreateTaxApprovalRequest,
    ): Promise<TaxApprovalList['items']> =>
      (
        await request(
          TaxApprovalList,
          `${ret(id)}/approvals`,
          post(parseInput(CreateTaxApprovalRequest, body)),
        )
      ).items,
    approve: async (
      id: string,
      approvalId: string,
      body: ApproveTaxApprovalRequest = {},
    ): Promise<TaxApprovalList['items']> =>
      (
        await request(
          TaxApprovalList,
          `${sub(id, 'approvals', approvalId, TaxApprovalId)}/approve`,
          post(parseInput(ApproveTaxApprovalRequest, body)),
        )
      ).items,
    returnToPreparer: async (
      id: string,
      approvalId: string,
      body: ReturnTaxApprovalRequest,
    ): Promise<TaxApprovalList['items']> =>
      (
        await request(
          TaxApprovalList,
          `${sub(id, 'approvals', approvalId, TaxApprovalId)}/return`,
          post(parseInput(ReturnTaxApprovalRequest, body)),
        )
      ).items,

    // Authorizations
    authorizations: async (id: string): Promise<TaxAuthorizationList['items']> =>
      (await request(TaxAuthorizationList, `${ret(id)}/authorizations`)).items,
    setAuthorizations: async (
      id: string,
      body: SetTaxAuthorizationsRequest,
    ): Promise<TaxAuthorizationList['items']> =>
      (
        await request(TaxAuthorizationList, `${ret(id)}/authorizations`, {
          method: 'PUT',
          body: parseInput(SetTaxAuthorizationsRequest, body),
        })
      ).items,
    linkAuthorization: async (
      id: string,
      authorizationId: string,
      body: LinkTaxAuthorizationRequest,
    ): Promise<TaxAuthorizationList['items']> =>
      (
        await request(
          TaxAuthorizationList,
          `${sub(id, 'authorizations', authorizationId, TaxAuthorizationId)}/link`,
          post(parseInput(LinkTaxAuthorizationRequest, body)),
        )
      ).items,
    wetSignature: async (
      id: string,
      authorizationId: string,
      body: WetSignatureRequest,
    ): Promise<TaxAuthorizationList['items']> =>
      (
        await request(
          TaxAuthorizationList,
          `${sub(id, 'authorizations', authorizationId, TaxAuthorizationId)}/wet-signature`,
          post(parseInput(WetSignatureRequest, body)),
        )
      ).items,

    // Documents
    documents: async (id: string): Promise<TaxReturnDocumentList['items']> =>
      (await request(TaxReturnDocumentList, `${ret(id)}/documents`)).items,
    linkDocument: async (
      id: string,
      body: LinkTaxReturnDocumentRequest,
    ): Promise<TaxReturnDocumentList['items']> =>
      (
        await request(
          TaxReturnDocumentList,
          `${ret(id)}/documents`,
          post(parseInput(LinkTaxReturnDocumentRequest, body)),
        )
      ).items,
    /** 409 DOCUMENT_LOCKED for a filed return or an acknowledgment. */
    unlinkDocument: async (id: string, documentId: string): Promise<OkResponse> =>
      request(OkResponse, sub(id, 'documents', documentId, DocumentId), { method: 'DELETE' }),
  };
}
export type TaxReturnWorkspaceClient = ReturnType<typeof createTaxReturnWorkspaceClient>;
