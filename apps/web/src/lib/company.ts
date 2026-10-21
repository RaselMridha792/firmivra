/**
 * Firmivra's company and legal details: footers, sign-up consent, privacy and terms links, the
 * support contact, and the SES and SMS registrations (docs/aws/). Change them here only.
 *
 * Address, phone, governing law, website and the company email confirmed by Octavia (Oct 5).
 * admin@firmivra.com is the company's public contact address; no personal addresses here. The
 * rest are placeholders until she sends them. Every placeholder starts with PLACEHOLDER so a
 * search finds what is still missing, and the legal pages leave them out (isPending).
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
  /** County where disputes are heard (Terms of Service). */
  county: 'PLACEHOLDER county',
  /** Where users and the SMS HELP reply send people. */
  supportEmail: 'admin@firmivra.com',
  privacyEmail: 'admin@firmivra.com',
  legalEmail: 'admin@firmivra.com',
  /**
   * Full links to the Privacy Policy and Terms of Service, for emails, SMS replies and the other
   * hosts. Read them on the server: APP_BASE_URL is server configuration. Pages on the firm
   * workspace host link LEGAL_PATHS instead.
   */
  get privacyUrl() {
    return appPageUrl(LEGAL_PATHS.privacy);
  },
  get termsUrl() {
    return appPageUrl(LEGAL_PATHS.terms);
  },
} as const;

/** Where Firmivra's legal pages are served on the firm workspace host (app/firm/(legal)/). */
export const LEGAL_PATHS = { privacy: '/privacy', terms: '/terms' } as const;

/** A page on the firm workspace host, from APP_BASE_URL. */
function appPageUrl(path: string): string {
  return new URL(path, process.env['APP_BASE_URL'] ?? 'http://app.localhost:3000').href;
}

/** A detail Octavia has not sent yet (it still starts with PLACEHOLDER), so pages leave it out. */
export function isPending(value: string): boolean {
  return value.startsWith('PLACEHOLDER');
}
