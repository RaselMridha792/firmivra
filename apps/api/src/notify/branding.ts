import type { Database } from '@firmivra/db';
import { logoUrl } from '../settings/logo-checks.js';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PRIMARY_COLOR,
} from '../client-auth/portal-info.controller.js';

/** How a message looks and whose name it carries. */
export interface Branding {
  /** The firm's name (header, footer and sender name), or Firmivra. */
  name: string;
  /** `#rrggbb`: the header and the button. */
  primaryColor: string;
  /** `#rrggbb`: the line under the header and beside quoted text. */
  accentColor: string;
  /** An https address of the logo, or null for the name alone. */
  logoUrl: string | null;
  /** IANA zone for times the data does not zone itself (when a link expires). */
  timeZone: string;
  /** False for Firmivra's own messages. */
  isFirm: boolean;
}

/**
 * Firmivra's own messages (firm applications): the platform navy and blue of packages/ui. Emails
 * need literal colours (mail clients ignore CSS variables).
 */
export const FIRMIVRA_BRANDING: Readonly<Branding> = {
  name: 'Firmivra',
  primaryColor: '#001B36',
  accentColor: '#005FCC',
  logoUrl: null,
  timeZone: 'America/New_York',
  isFirm: false,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A `#rrggbb` colour, or the fallback for anything else (the value goes into a style attribute). */
export function hexColor(value: string | null | undefined, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value.toUpperCase() : fallback;
}

/** An IANA zone Intl knows, else Firmivra's. */
function timeZone(value: string | null | undefined): string {
  if (!value) return FIRMIVRA_BRANDING.timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return FIRMIVRA_BRANDING.timeZone;
  }
}

/** The businessId names no firm: a programming error, so NotifyService.send rejects. */
export class UnknownFirmError extends Error {
  constructor() {
    super('Unknown firm for this message');
    this.name = 'UnknownFirmError';
  }
}

/** A business id: a UUID (the column is uuid, so anything else could only fail in the query). */
const BUSINESS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads a firm's branding in that firm's own scope (row-level security shows nothing of another
 * firm). Colours the firm has not set come from the portal's defaults, so emails match the portal.
 * An id that is not a UUID is UnknownFirmError before any query; a database error is left to
 * NotifyService, which turns it into NotifyDeliveryError without the database's message.
 */
export class BrandingSource {
  constructor(
    private readonly db: Pick<Database, 'forBusiness'>,
    /** The portal site's origin: with it, a firm's logo is an address a mail client can load. */
    private readonly portalOrigin?: string,
  ) {}

  async load(businessId: string | null): Promise<Branding> {
    if (businessId === null) return FIRMIVRA_BRANDING;
    if (typeof businessId !== 'string' || !BUSINESS_ID.test(businessId)) {
      throw new UnknownFirmError();
    }
    const scope = this.db.forBusiness(businessId);
    const [firm, settings] = await Promise.all([
      scope.business.findUnique({ where: { id: businessId }, select: { name: true, slug: true } }),
      scope.businessSettings.findUnique({
        where: { businessId },
        select: { brandColor: true, accentColor: true, timezone: true, logoLightKey: true },
      }),
    ]);
    if (!firm) throw new UnknownFirmError();
    return {
      name: firm.name,
      primaryColor: hexColor(settings?.brandColor, DEFAULT_PRIMARY_COLOR),
      accentColor: hexColor(settings?.accentColor, DEFAULT_ACCENT_COLOR),
      // The lasting public address of the logo for light backgrounds (mail is light), not a signed
      // link: it must still work when the mail is opened.
      logoUrl: this.portalOrigin
        ? logoUrl(this.portalOrigin, firm.slug, settings?.logoLightKey, 'light')
        : null,
      timeZone: timeZone(settings?.timezone),
      isFirm: true,
    };
  }
}
