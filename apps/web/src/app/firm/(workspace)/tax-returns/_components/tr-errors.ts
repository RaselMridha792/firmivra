import { ApiRequestError, type TaxReturnBlocker } from '@firmivra/types';
import { errorMessage } from '../../../../../lib/errors';

// Tax Returns' error words, apart from tr-shared.tsx so plain unit tests can load them.

export const BLOCKER_LABEL: Record<TaxReturnBlocker, string> = {
  VALIDATION_NOT_RUN: 'Run final validation',
  VALIDATION_ERRORS: 'Fix the validation errors',
  WARNINGS_NOT_ACKNOWLEDGED: 'Acknowledge the validation warnings',
  APPROVAL_PENDING: 'Complete the required approvals',
  APPROVAL_RETURNED: 'A reviewer returned it: fix it and ask again',
  AUTHORIZATION_UNSIGNED: 'Obtain the client signatures',
  NO_FILING_TRANSMITTED: 'Record a transmission (or paper filing) first',
  FILINGS_NOT_ACCEPTED: 'Every required filing must be accepted or paper filed',
  ORIGINAL_NOT_FILED: 'The original return was never filed',
  VALIDATION_ISSUES_OPEN: 'Resolve the open validation errors',
};

/** The module's error codes in plain words (lib/errors has the generic ones). */
export const TR_ERRORS: Record<string, string> = {
  DUPLICATE_RETURN: 'This client already has this return for that year.',
  STATUS_BLOCKED: 'This return cannot move there yet. Check its next steps.',
  REASON_REQUIRED: 'Say why the return goes back a step.',
  REJECTION_NOT_RECORDED:
    "Record the agency's rejection of a transmission first, on the E-File page.",
  RETURN_FILED: 'The return is filed; an extension is for a return not filed yet.',
  RETURN_LOCKED: 'A filed return, a transmission or a decided approval does not change.',
  ATTEMPT_PENDING: 'Record the answer to the last transmission first.',
  FILING_IN_USE: 'A jurisdiction with transmissions stays on the return.',
  DOCUMENT_LOCKED: 'A filed return or an acknowledgment stays linked.',
  INVALID_DOCUMENT: "That file is not one of this client's documents.",
  NOT_A_MEMBER: 'Choose an active member of your firm.',
  ORIGINAL_NOT_FILED: 'Only a filed return can be amended.',
  CLIENT_ARCHIVED: 'Restore the client first.',
  FORBIDDEN: "Your role can't do this. Ask an Owner or Admin.",
};

/**
 * F20b (Tax Returns Review 2): a refused change says the API's own reason and what still blocks
 * it (its blockers, in words), e.g. "Resolve the validation errors first. Still to do: Resolve the
 * open validation errors." The generic line only when the API gives neither.
 */
export function trErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === 'STATUS_BLOCKED') {
    const raw = error.rawDetails as { blockers?: unknown } | undefined;
    const blockers = Array.isArray(raw?.blockers) ? raw.blockers : [];
    const todo = blockers
      .map((b) => BLOCKER_LABEL[b as TaxReturnBlocker])
      .filter((label): label is string => Boolean(label));
    const reason = error.message.trim();
    if (reason || todo.length)
      return [
        reason ? (reason.endsWith('.') ? reason : `${reason}.`) : TR_ERRORS['STATUS_BLOCKED'],
        todo.length ? `Still to do: ${todo.join('; ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
  }
  return errorMessage(error, TR_ERRORS);
}
