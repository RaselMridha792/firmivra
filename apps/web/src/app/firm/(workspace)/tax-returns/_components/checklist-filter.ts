import type { FirmDocumentRequest, TaxReturnDetail } from '@firmivra/types';

/**
 * ACC-DOC (R61's live check): the requests a return's Document Checklist lists. Those sent for
 * this return, and those sent for no return of the same tax year and service (the return's
 * engagement), never another return's or another service's. A return with no service lists only
 * the requests sent for it (else its checklist is empty), never the client's other requests of
 * that year. A cancelled request is left out.
 */
export function checklistRequests(
  requests: readonly FirmDocumentRequest[],
  detail: Pick<TaxReturnDetail, 'id' | 'taxYear' | 'engagement'>,
): FirmDocumentRequest[] {
  return requests.filter(
    (r) =>
      r.status !== 'CANCELLED' &&
      (r.taxReturn
        ? r.taxReturn.id === detail.id
        : detail.engagement !== null &&
          r.taxYear === detail.taxYear &&
          r.service.id === detail.engagement.id),
  );
}
