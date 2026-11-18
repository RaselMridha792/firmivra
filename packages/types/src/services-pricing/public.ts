import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { FirmSlug } from '../schemas.js';
import { PublicLinkState } from '../public-links/schemas.js';
import { ServicePackageId } from './schemas.js';

// Client Portal Review One SP-1 (Services & Pricing Oct 21 S7, S12): the page behind a package's
// public link (`{PORTAL_BASE_URL}/{firmSlug}/packages/{id}`), read without signing in. A package
// is LIVE only while it is Active, Visible to Clients and set to Display on Website/Portal; in
// any other state the page refuses it and shows nothing of it. What a client sees: the name,
// short description, category, price and savings, the services included and the ones not
// included, and the optional add-ons when the firm lets clients add them. Never internal notes.

export const PublicPackageDetails = z.object({
  name: z.string(),
  shortDescription: z.string(),
  category: z.string().nullable(),
  /** The package's price; null while an included service needs a quote. */
  packagePriceCents: z.number().int().nullable(),
  /** "You save"; null when it cannot be guaranteed. */
  savingsCents: z.number().int().nullable(),
  included: z.array(z.object({ name: z.string() })),
  /** Listed with the package but not part of its price (S7). */
  notIncluded: z.array(z.object({ name: z.string() })),
  /**
   * S12: the appointment type the page's Book opens (its booking link); null when the package
   * has none, or it is archived or not booked online (sign in and contact the firm instead).
   */
  bookingTypeId: z.uuid().nullable().default(null),
  /** Only when the firm lets clients add optional add-ons. */
  addOns: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      priceCents: z.number().int(),
    }),
  ),
});
export type PublicPackageDetails = z.infer<typeof PublicPackageDetails>;

export const PublicPackage = z.object({
  id: ServicePackageId,
  state: PublicLinkState,
  /** Only while LIVE. */
  details: PublicPackageDetails.nullable(),
});
export type PublicPackage = z.infer<typeof PublicPackage>;

/** `api.publicPackages(slug)`: the portal's package page, read without signing in. */
export function createPublicPackagesClient(request: ApiRequest, firmSlug: string) {
  return {
    get: async (id: string): Promise<PublicPackage> =>
      request(
        PublicPackage,
        `/portal/${parseInput(FirmSlug, firmSlug)}/packages/${parseInput(ServicePackageId, id)}`,
      ),
  };
}
export type PublicPackagesClient = ReturnType<typeof createPublicPackagesClient>;
