/**
 * Firmivra's company and legal details: footers, sign-up consent, privacy and terms links, the
 * support contact, and the SES and SMS registrations (docs/aws/). Change them here only.
 *
 * Address, phone, governing law and website confirmed by Octavia (Oct 5). The rest are
 * placeholders until she sends them; email addresses are never committed. Every placeholder
 * starts with PLACEHOLDER so a search finds what is still missing.
 */
export const COMPANY = {
  /** Registered legal name, as on the incorporation papers. */
  legalName: 'PLACEHOLDER company legal name',
  /** Mailing address. */
  address: {
    line1: '1393 Duncan Lane',
    line2: 'Unit 100',
    city: 'Auburn',
    state: 'GA',
    postalCode: '30011',
    country: 'USA',
  },
  phone: '(770) 238-9815',
  website: 'https://firmivra.com',
  /** Law that governs the Terms of Service and Privacy Policy. */
  governingLaw: 'Georgia, USA',
  /** County named in the governing-law clause. */
  county: 'PLACEHOLDER county',
  /** Where users and the SMS HELP reply send people. */
  supportEmail: 'PLACEHOLDER support email',
  privacyEmail: 'PLACEHOLDER privacy email',
  legalEmail: 'PLACEHOLDER legal email',
  privacyUrl: 'PLACEHOLDER privacy policy URL',
  termsUrl: 'PLACEHOLDER terms of service URL',
} as const;
