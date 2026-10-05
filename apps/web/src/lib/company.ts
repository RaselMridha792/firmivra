/**
 * Firmivra's company and legal details: footers, sign-up consent, privacy and terms links, the
 * support contact, and the SES and SMS registrations (docs/aws/). Change them here only.
 *
 * Placeholders until Octavia sends the company details (docs/SETUP-LOG.md, open items).
 * Every placeholder starts with PLACEHOLDER so a search finds what is still missing.
 */
export const COMPANY = {
  /** Registered legal name, as on the incorporation papers. */
  legalName: 'PLACEHOLDER company legal name',
  address: {
    line1: 'PLACEHOLDER street address',
    line2: '',
    city: 'PLACEHOLDER city',
    state: 'PLACEHOLDER state',
    postalCode: 'PLACEHOLDER ZIP code',
    country: 'PLACEHOLDER country',
  },
  /** Where users and the SMS HELP reply send people. */
  supportEmail: 'PLACEHOLDER support email',
  privacyUrl: 'PLACEHOLDER privacy policy URL',
  termsUrl: 'PLACEHOLDER terms of service URL',
} as const;
