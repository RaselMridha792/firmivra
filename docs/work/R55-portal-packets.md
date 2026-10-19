# R55: Request packets in the client portal

Contract: `packages/types/src/documents/portal-packets.ts` and three methods on `api.myDocuments(slug)`: `packets`, `packet`, `submitPacket`. API: `apps/api/src/storage/` (next PR). Design: `docs/mockups/firm-workspace/documents/source/firmivra-frame-7-client-document-request-upload.jpg` (Document Request & Upload). Tables: R37's `document_request_packets` and `document_requests` (`packet_id`, `required`, `sort_order`).

## Steps

- [x] 1. Contract: the list, one packet (items with their files, progress, request details, activity), Submit for Review, and two error codes.
- [ ] 2. API, with unit, e2e and tenant-isolation tests.
- [ ] 3. The portal screen (whoever owns the portal Documents pages), on this contract.

## Decisions (contract)

1. **What the client sees.**
   - Only their own packets that were sent: never a DRAFT, a CANCELLED packet, or one addressed to a member of the firm.
   - A portal login that is not the household's sees open packets only (OPEN, SUBMITTED), as with single requests.
   - Another client's packet is 404.
2. **An item is a document request.**
   - Its upload is the portal's ordinary upload with `requestId`; there is no new upload route.
   - While the packet is OPEN and allows multiple files, a SUBMITTED item takes more files.
   - Replace is a new upload; the old file stays.
   - A submitted, completed or expired packet takes no uploads (409 REQUEST_CLOSED).
3. **Progress.** An item counts as answered when it is SUBMITTED, ACCEPTED or NOT_AVAILABLE ("I don't have this", with a reason). Optional items don't count toward "x of y required".
4. **Submit for Review.** The packet goes OPEN → SUBMITTED; the database stamps `submitted_at`. It is refused with:
   - 409 PACKET_INCOMPLETE while a required item is unanswered;
   - 409 PACKET_CLOSED once the packet is not open (already submitted, completed or expired).
   It is audited, and the firm is notified as for a single request.
5. **The view** (NOT_STARTED, IN_PROGRESS, READY, SUBMITTED, COMPLETED, EXPIRED) and `overdue` are computed, not stored.
6. **Activity** comes from the records' own times: sent, each file uploaded, each item's latest answer or review, submitted, completed. Who acted is only "You" or "Your firm": the records don't name the staff member for a review.
7. **No new table.**
   - The Messages tab has no packet thread. It shows its frame with an empty state and "Message Your Firm", which opens the portal's Messages.
   - Save Progress needs no call: every upload is saved when it finishes.
   - Submit takes no note: nothing stores one.
8. **Single requests are unchanged.** The existing request list (`requests()`) gains an optional `packet` reference, so the screen can group items by packet; the API PR fills it.

## Needs from others

- None for the API: the packet table's firm-scoped policy and status rules already allow OPEN → SUBMITTED.
- A packet message thread (the Messages tab) would need a table: R0, if wanted.
