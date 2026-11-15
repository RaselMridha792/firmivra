import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Intake Forms Review Two 14b: no path removes a record of the six minimum-retention categories
// (client-sent, company-sent and tax return documents, submitted intake forms, portal messages,
// system-sent emails). This reads the API's own source, so a new removal fails here until it
// calls RetentionGuard.assertRemovable (src/retention/retention-guard.ts) in its transaction and
// is listed below with why. Lead uploads are not client-sent documents until the lead becomes a
// client (the lead's decision, Nov 15), so their removals are listed, not guarded. Every timed
// job is run past every minimum in e2e/retention-proof (R56).

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(path) ? [path] : [];
  });
}
const FILES = sources(SRC).map((path) => ({
  file: relative(SRC, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));
const where = (pattern: RegExp) =>
  FILES.filter((f) => pattern.test(f.text))
    .map((f) => f.file)
    .sort();

describe('no path removes a record of the six retention categories (14b)', () => {
  it('never hard-deletes documents, intakes, submissions, messages or emails', () => {
    expect(
      where(
        /\.(document|intake|intakeSubmission|message|messageThread|notification|notificationDelivery)\.(delete|deleteMany)\(/,
      ),
    ).toEqual([]);
    expect(
      where(
        /DELETE\s+FROM\s+"?(documents|intakes|intake_submissions|messages|message_threads|notifications|notification_deliveries)\b/i,
      ),
    ).toEqual([]);
  });

  it('never runs the ops-only removals, and nothing removes or archives on a document type’s years', () => {
    // withdraw_document() and app_delete_business_data() run as the migrate role only (both are
    // REVOKEd from PUBLIC; the second is the demo unseed's): no route or job of the API calls them.
    expect(where(/withdraw_document|app_delete_business_data/)).toEqual([]);
    // A document type's "Keep documents" years set retention_until at upload (uploads.service):
    // a floor the database only moves later. The documents_delete policy would let a firm-scope
    // delete through after it, but nothing reads it to remove or archive (and no document delete
    // exists at all, above).
    expect(where(/retentionUntil\s*:\s*\{/)).toEqual([]);
    expect(where(/retention_until\s*<|retentionUntil\s*</i)).toEqual([]);
  });

  it('removes a tax return’s document links only where the document itself stays', () => {
    // Unlinking a document from a return (the document stays with its client and service).
    expect(where(/\.taxReturnDocument\.(delete|deleteMany)\(/)).toEqual([
      'tax-returns/review.service.ts',
    ]);
    // Deleting a return that was never filed (its links go with it, its documents stay: the
    // database refuses a document delete through the link, ON DELETE RESTRICT).
    expect(where(/\.taxReturn\.(delete|deleteMany)\(/)).toEqual([
      'tax-returns/tax-returns.service.ts',
    ]);
  });

  it('removes stored files only in these places, none of them a record of the six', () => {
    const REASONS: Record<string, string> = {
      'admin-settings/admin-branding.service.ts': 'platform branding: an upload never confirmed',
      'admin-support/support-files.service.ts': 'support files: an upload never confirmed',
      'agreements/agreement-files.service.ts': 'agreements: an upload never confirmed',
      'begin-online/begin-online.service.ts': 'lead drafts nobody reopened (lead uploads)',
      'begin-online/draft-submit.service.ts': 'lead uploads in hidden slots at submit',
      'begin-online/draft-uploads.service.ts': 'a lead draft’s own upload, removed by the visitor',
      'communications/communications-extras.service.ts': 'an attachment of a draft communication',
      'firm-applications/apply-respond.service.ts':
        'an applicant’s response upload refused at send, before any firm exists (none of the six)',
      'esign/lifecycle/lifecycle.service.ts': 'copies made for a replacement that failed',
      'esign/requests/documents.service.ts': 'a file of an e-sign draft',
      'esign/requests/requests.service.ts': 'the files of a discarded e-sign draft',
      'esign/signer/signer-files.service.ts': 'a signer’s attachment before signing',
      'esign/templates/template-copy.service.ts': 'a template copy that failed',
      'intake-link/intake-link.service.ts': 'lead uploads in hidden slots at submit',
      'intake-link/link-uploads.service.ts': 'a lead’s own upload to its open intake',
      'leads/lead-email.service.ts': 'a refused image of a lead email',
      'leads/lead-files.service.ts': 'a lead’s file (not a client-sent document until conversion)',
      'locations/location-photo.service.ts': 'an office photo',
      'messages/outbound-files.service.ts': 'a file of a draft outbound message',
      'reports/report-files.ts': 'a report export',
      'settings/brand-assets.service.ts': 'firm branding assets',
      'settings/logo.service.ts': 'the firm logo',
      'staff/staff-documents.service.ts': 'staff documents: an upload never confirmed',
      'storage/document-storage.ts': 'the storage adapter itself (remove)',
      'storage/uploads.service.ts': 'an upload refused at confirm (never a document)',
      'system-status/system-status.controller.ts': 'the status check’s own probe object',
      'templates/template-attachments.service.ts': 'template attachments',
      'templates/template-import-files.ts': 'template import files',
    };
    expect(where(/(storage|store)\.remove\(|DeleteObjectCommand/)).toEqual(
      Object.keys(REASONS).sort(),
    );
  });

  it('has only these DELETE routes where the six categories live, none removing such a record', () => {
    const ROUTES: Record<string, string[]> = {
      // A folder (its documents stay) and an item of a request template.
      'documents/library.controller.ts': ["'document-folders/:id'", "':id/items/:itemId'"],
      // Takes a file out of an open intake: the document stays the client's (detach only).
      'intake/intakes.controller.ts': ["':id/uploads/:uploadId'"],
      // A lead's own upload to its open intake (lead uploads; the database allows it only then).
      'intake-link/intake-link.controller.ts': ["'uploads/:uploadId'"],
      // A mute, staff notes and a note's reminder: not portal messages.
      'messages/messages.controller.ts': ["':id/mute'"],
      'messages/notes.controller.ts': ["':id'", "'reminder'"],
      // A file of a draft outbound message.
      'messages/outbound.controller.ts': ["':id/files/:fileId'"],
      // A return never filed (documents stay); a checklist item; a document link (document stays).
      'tax-returns/tax-returns.controller.ts': ["':id'"],
      'tax-returns/workspace.controller.ts': [
        "':id/checklist/:itemId'",
        "':id/documents/:documentId'",
      ],
    };
    const dirs =
      /^(documents|intake|intake-link|intake-workspace|messages|notifications|storage|tax-returns|client-portal)\//;
    const found: Record<string, string[]> = {};
    for (const f of FILES.filter((x) => dirs.test(x.file) && x.file.endsWith('.controller.ts'))) {
      const paths = [...f.text.matchAll(/@Delete\(([^)]*)\)/g)].map((m) => m[1]!.trim());
      if (paths.length) found[f.file] = paths;
    }
    expect(found).toEqual(ROUTES);
  });

  it('keeps one guard for any future removal: RetentionGuard.assertRemovable', () => {
    expect(where(/export const RetentionGuard\b/)).toEqual(['retention/retention-guard.ts']);
  });
});
