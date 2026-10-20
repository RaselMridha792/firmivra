import {
  AmendTaxReturnRequest,
  ApproveTaxApprovalRequest,
  CarryForwardTaxReturnRequest,
  ChangeTaxReturnStatusRequest,
  CreateTaxApprovalRequest,
  CreateTaxChecklistItemRequest,
  CreateWorkspaceTaxReturnRequest,
  EfileReportQuery,
  LinkTaxAuthorizationRequest,
  LinkTaxReturnDocumentRequest,
  PaperFiledRequest,
  RecordTaxFilingAttemptRequest,
  ReturnTaxApprovalRequest,
  SetTaxAuthorizationsRequest,
  SetTaxReturnFilingsRequest,
  TaxReturnsQuery,
  TaxReturnSummaryQuery,
  UpdateTaxChecklistItemRequest,
  UpdateTaxFilingAttemptRequest,
  UpdateTaxReturnDetailsRequest,
  UpdateTaxReturnFilingRequest,
  WetSignatureRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED: a NUL
// character or half of a surrogate pair in any string.

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const IdParam = z.uuid();
export const ReturnsQ = clean(TaxReturnsQuery);
export const SummaryQ = clean(TaxReturnSummaryQuery);
export const CreateReturnBody = clean(CreateWorkspaceTaxReturnRequest);
export const UpdateDetailsBody = clean(UpdateTaxReturnDetailsRequest);
export const StatusBody = clean(ChangeTaxReturnStatusRequest);
export const AmendBody = clean(AmendTaxReturnRequest);
export const CarryForwardBody = clean(CarryForwardTaxReturnRequest);
export const SetFilingsBody = clean(SetTaxReturnFilingsRequest);
export const UpdateFilingBody = clean(UpdateTaxReturnFilingRequest);
export const AttemptBody = clean(RecordTaxFilingAttemptRequest);
export const UpdateAttemptBody = clean(UpdateTaxFilingAttemptRequest);
export const PaperFiledBody = clean(PaperFiledRequest);
export const ChecklistItemBody = clean(CreateTaxChecklistItemRequest);
export const UpdateChecklistItemBody = clean(UpdateTaxChecklistItemRequest);
export const ApprovalBody = clean(CreateTaxApprovalRequest);
export const ApproveBody = clean(ApproveTaxApprovalRequest);
export const ReturnApprovalBody = clean(ReturnTaxApprovalRequest);
export const SetAuthorizationsBody = clean(SetTaxAuthorizationsRequest);
export const LinkAuthorizationBody = clean(LinkTaxAuthorizationRequest);
export const WetSignatureBody = clean(WetSignatureRequest);
export const LinkDocumentBody = clean(LinkTaxReturnDocumentRequest);
export const EfileQ = clean(EfileReportQuery);
