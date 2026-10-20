# Super Admin stage D4: platform legal documents (contract note)

Migration `20261019040000_r0_platform_legal`. This note is for the API session that builds System Settings' legal documents (R55), and for the firm sign-up and activation flow (R4's) that records acceptance.

These are Firmivra's own Terms of Service, Privacy Policy, Data Processing Agreement and Acceptable Use Policy, for the firms on the platform. They are not a firm's own text for its clients; that stays in `firm_legal_documents`.

## Tables

| Table | What it holds | The app may |
| --- | --- | --- |
| `platform_legal_documents` | One version of one kind: title, Markdown body, summary of changes, status, effective time, whether firms must accept it again | select, insert, update, delete (drafts only) |
| `platform_legal_acceptances` | Who accepted which published version, and the evidence | select, insert (insert-only) |

## Documents

**Versions:** numbered 1, 2, 3 per `kind`. Insert the next number (`max(version) + 1` for the kind; the team reads every row). Anything else is refused with "the next … version is N".

**Statuses:**

| Status | Meaning | What can change |
| --- | --- | --- |
| `DRAFT` | Being written | Everything except kind and version; it can also be deleted |
| `PUBLISHED` | In force for its kind (one at a time) | Nothing, except retiring it |
| `RETIRED` | Replaced or withdrawn; kept for the acceptances | Nothing |

**Publishing:**
- To publish, set `status = 'PUBLISHED'` on a draft.
- The database stamps `published_at` and `published_by_user_id` (the signed-in admin).
- It sets `effective_at` to now, unless the draft gave a date.
- It retires the kind's previous published version (sets `retired_at`).
- Publish a new version to change the text.

**Retiring:** set `RETIRED` on a published version to withdraw it with nothing replacing it. A draft is deleted instead of retired.

**Database-stamped columns:** `created_*` and `updated_*`.

**Who reaches it:**
- **Every scope** reads published versions: firm sign-up and activation (platform scope), the workspace, and the portal footer links.
- **The Super Admin team (admin scope)** and the platform's jobs also read drafts and retired versions.
- **Writes** are the team's only. Which team members may write is the API's check (the `settings.*` keys).

## Acceptances

**What a row holds:**
- `document_id`: must be a published version, or the insert is refused.
- `user_id` or `firm_application_id`: at least one is required. An applicant has no login yet, so their acceptance names the firm application.
- `linked_business_id`: the firm, once there is one.
- `ip_address` (inet) and `user_agent` (up to 500 characters).

**The database stamps `accepted_at`.** Rows are never updated or deleted.

**Who records them:**
- The platform's sign-up and activation flows (platform scope).
- A firm, for itself (business scope, `linked_business_id` = the firm), when a member accepts a new version that has `requires_reacceptance`.

**Who reads them:** the team and the platform read all of them; a firm reads only its own.

**Deleting a firm or an application** clears the link (`SET NULL`), and the evidence stays. The column is named `linked_business_id`, like `sales_opportunities`, so `app_delete_business_data` treats it as a platform record, not firm data.

## For the API

**Super Admin:**
- `GET /api/v1/admin/legal-documents`: a list per kind with versions.
- `POST /api/v1/admin/legal-documents`: a new draft, numbered next.
- `PATCH /api/v1/admin/legal-documents/:id`: edit a draft.
- `POST /api/v1/admin/legal-documents/:id/publish` and `/retire`; `DELETE` for drafts.
- `GET /api/v1/admin/legal-documents/:id/acceptances`: who accepted, paged.

**Public:**
- `GET /api/v1/legal/:kind`: the published version, for sign-up and the footers.

**Firm:**
- On sign-in, if the published Terms has `requires_reacceptance` and the firm (or user) has no acceptance of it, ask before continuing.
- Record the acceptance in business scope.

**Audit:** every publish, retire and delete writes `audit_logs` (category `DATA`), with no document text.

## Seed

Terms of Service and Privacy Policy, version 1, published by the Super Admin (a kind that already has a version is left alone), plus LVP's owner's acceptance of the Terms. Demo rows are not planned: Rasel stopped the demo seed groups on Oct 19.
