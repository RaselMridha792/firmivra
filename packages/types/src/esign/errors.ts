import { z } from 'zod';

/** Stable `error.code` values of Firm Sign, besides the generic ones in ApiError. */
export const EsignErrorCode = z.enum([
  /** 403 (firm routes): Firm Sign is off for this firm. Public and signer routes answer 404. */
  'MODULE_OFF',
  /** 409: the request's status does not allow this (for example editing a sent request). */
  'INVALID_STATE',
  /** 409 (send): the readiness check has problems; read `readiness()` for them. */
  'NOT_READY',
  /** 409 (confirm, from-vault): the PDF has a password or is encrypted. */
  'PDF_ENCRYPTED',
  /** 409 (confirm, from-vault): the file could not be read as a PDF or an image. */
  'PDF_UNREADABLE',
  /** 409: the packet would have more than 100 pages. */
  'TOO_MANY_PAGES',
  /** 409: a file is still being checked for malware. */
  'SCAN_PENDING',
  /** 409: a file failed the malware check or could not be checked. */
  'FILE_BLOCKED',
  /** Only PDF, JPG and PNG files: 400 from createUpload (before anything is sent), 409 from-vault. */
  'FILE_TYPE_NOT_ALLOWED',
  /** 410: the upload ticket is too old or was used; start the upload again. */
  'UPLOAD_EXPIRED',
  /** 409 (confirm): the stored file is not what `createUpload` described. */
  'UPLOAD_MISMATCH',
  /** 409: the service is not this client's, or not PENDING or ACTIVE. */
  'ENGAGEMENT_MISMATCH',
  /** 409 (update): change the client only after removing the old client's logins as recipients. */
  'RECIPIENTS_LINKED',
  /** 409 (recipients): that portal login is not the client's, or not ACTIVE. */
  'LOGIN_NOT_ACTIVE',
  /** 409 (recipients): the staff member is not an active member of the firm. */
  'NOT_A_MEMBER',
  /** 409 (page plan): a page with fields cannot be rotated; move or remove its fields first. */
  'PAGE_HAS_FIELDS',
  /** 409: the request is completed, declined, expired or voided. */
  'REQUEST_CLOSED',
  /** 409 (remind): reminded less than an hour ago. */
  'REMIND_TOO_SOON',
  /** 409 (correct): that recipient already signed, declined or approved. */
  'RECIPIENT_DONE',
  // Signer routes (portal/{slug}/sign), templates and bulk send.
  /** 404: any unknown, expired, used or other firm's link. One answer for all of them. */
  'LINK_INVALID',
  /** 400: the email or access code is wrong or expired. */
  'CODE_INVALID',
  /** 429: too many wrong codes; ask for a new one. */
  'CODE_LOCKED',
  /** 409: a signer before this one has not signed yet. */
  'NOT_YOUR_TURN',
  /** 409 (finish): a required field is empty. */
  'REQUIRED_FIELDS_MISSING',
  /** 409: the template is archived. */
  'TEMPLATE_ARCHIVED',
  /** 400: a bulk send takes at most 200 clients. */
  'BULK_LIMIT',
  /** 409 (signer): finish the earlier step first (the code, then the consent). */
  'WRONG_STEP',
  /** 429 (signer): a code was sent less than a minute ago. */
  'CODE_TOO_SOON',
  /** 409 (signer consent): the firm published a newer consent text; read it again. */
  'CONSENT_OUTDATED',
  /** 409 (signer finish): adopt a signature (and initials, when asked) first. */
  'SIGNATURE_REQUIRED',
  /**
   * 409 (use template, bulk send): say who fills each role that could not be filled from the
   * client, and give the access code each ACCESS_CODE role needs (unless IN_PERSON); in a bulk
   * send, choose another sign-in check for such a role instead (no shared codes).
   */
  'TEMPLATE_ROLES_UNFILLED',
  /** 409 (templates): another active template has that name. */
  'TEMPLATE_NAME_TAKEN',
  /**
   * 409 (save-as-template, save-as-version): a file came from the client's documents; a template
   * never holds a client's files.
   */
  'TEMPLATE_HAS_CLIENT_FILES',
  /** 400 (signer adopt): the image is not a PNG, or over 200 KB or 1600x600. */
  'IMAGE_INVALID',
  // Contract 3: approvals, roles and in-person signing.
  /** 403 (approval): the caller is not an approver on this request. */
  'NOT_AN_APPROVER',
  /** 409 (roles): an Owner's or Admin's Firm Sign access follows their firm role. */
  'ROLE_FIXED',
  /** 403: an in-person signing is open on this session; unlock it with your password first. */
  'KIOSK_LOCKED',
  /** 400 (in-person exit): the password is not right. */
  'PASSWORD_WRONG',
  /** 409 (in-person): this recipient does not sign in person. */
  'NOT_IN_PERSON',
  /**
   * 409 (recipients, use template): an approver is never the request's sender, and is an Owner,
   * Admin or Firm Sign Manager.
   */
  'APPROVER_NOT_ALLOWED',
]);
export type EsignErrorCode = z.infer<typeof EsignErrorCode>;

/** What users see: `errorMessage(error, ESIGN_ERRORS)` on every Firm Sign screen. */
export const ESIGN_ERRORS = {
  MODULE_OFF: 'Firm Sign is not turned on for this firm.',
  INVALID_STATE: 'This request has changed. Reload and try again.',
  NOT_READY: 'This request is not ready to send. Fix the items in the readiness check.',
  PDF_ENCRYPTED: 'This PDF has a password. Remove the password and upload it again.',
  PDF_UNREADABLE: "This file couldn't be read. Save it as a PDF again and upload it.",
  TOO_MANY_PAGES: 'A request can have at most 100 pages.',
  SCAN_PENDING: 'This file is still being checked. Try again in a moment.',
  FILE_BLOCKED: "This file couldn't be checked, so it can't be used.",
  FILE_TYPE_NOT_ALLOWED: 'Only PDF, JPG and PNG files can be sent for signature.',
  UPLOAD_EXPIRED: 'This upload has expired. Please try again.',
  UPLOAD_MISMATCH: "The uploaded file doesn't match what was expected. Upload it again.",
  ENGAGEMENT_MISMATCH: 'Choose one of this client’s open services.',
  RECIPIENTS_LINKED: 'Remove this client’s recipients before choosing another client.',
  LOGIN_NOT_ACTIVE: 'This portal login is not active. Choose another recipient.',
  NOT_A_MEMBER: 'This person is not an active member of the firm.',
  PAGE_HAS_FIELDS: 'Move or remove the fields on this page before rotating it.',
  REQUEST_CLOSED: 'This request is closed, so it can no longer change.',
  REMIND_TOO_SOON: 'A reminder went out less than an hour ago. Try again later.',
  RECIPIENT_DONE: 'This recipient has already finished.',
  LINK_INVALID: 'This link is not valid any more. Ask the sender for a new one.',
  CODE_INVALID: 'That code is not right or has expired.',
  CODE_LOCKED: 'Too many tries. Ask for a new code.',
  NOT_YOUR_TURN: 'Someone else signs before you. You’ll get an email when it’s your turn.',
  REQUIRED_FIELDS_MISSING: 'Fill in every required field before finishing.',
  TEMPLATE_ARCHIVED: 'This template is archived.',
  BULK_LIMIT: 'A bulk send can go to at most 200 clients.',
  WRONG_STEP: 'Finish the step before this one first.',
  CODE_TOO_SOON: 'A code was just sent. Wait a minute before asking for another.',
  CONSENT_OUTDATED: 'The consent text has changed. Read it again and accept it.',
  SIGNATURE_REQUIRED: 'Adopt your signature before finishing.',
  TEMPLATE_ROLES_UNFILLED:
    'Choose who fills each role in this template, and set an access code where one is needed.',
  TEMPLATE_NAME_TAKEN: 'Another template already has this name.',
  TEMPLATE_HAS_CLIENT_FILES:
    "Files from the client's documents can't go into a template. Upload a blank copy instead.",
  IMAGE_INVALID: 'Use a PNG image of at most 200 KB and 1600 by 600 pixels.',
  NOT_AN_APPROVER: 'Only this request’s approvers can approve it.',
  ROLE_FIXED: 'Owners and Admins always have full access to Firm Sign.',
  KIOSK_LOCKED: 'An in-person signing is open. Enter your password to return.',
  PASSWORD_WRONG: 'That password is not right.',
  NOT_IN_PERSON: 'This recipient does not sign in person.',
  APPROVER_NOT_ALLOWED:
    'An approver must be an Owner, Admin or Firm Sign Manager, and not the person sending it.',
} as const satisfies Record<EsignErrorCode, string>;
