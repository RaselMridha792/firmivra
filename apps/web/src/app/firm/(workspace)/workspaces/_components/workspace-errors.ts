export const WORKSPACE_ERRORS: Record<string, string> = {
  ENGAGEMENT_CLOSED: 'This service is closed. You can no longer change its work.',
  INVALID_STAGE: 'Choose a stage available for this service.',
  INTERNAL_DOCUMENT: 'Internal documents cannot be shared with the client.',
  CLIENT_ARCHIVED: 'This client is archived. Restore the client before changing their work.',
  SCAN_PENDING: 'This file is still being checked. Try again when the scan finishes.',
  FILE_BLOCKED: 'This file did not pass its security scan and cannot be downloaded.',
  WRONG_REPORT_KIND: 'Choose a report type available for this workspace.',
  DOCUMENT_MISMATCH: 'Choose a document belonging to this service.',
  REPORT_WAS_PUBLISHED:
    'This report was previously published. Unpublish it instead of deleting it.',
  CLIENT_NOT_ASSIGNED: 'Assign this client to the selected staff member first.',
  ENGAGEMENT_MISMATCH: 'Choose a service belonging to this client.',
};
