import { LOGO_LIMITS, type LogoContentType, type LogoVariant } from '@firmivra/types';

const starts = (bytes: Uint8Array, at: number, text: number[]) =>
  bytes.length >= at + text.length && text.every((b, i) => bytes[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * The image type the bytes really are (PNG, JPEG or WebP), whatever the file was called or said
 * it was; null for anything else, SVG included.
 */
export function sniffLogoType(bytes: Uint8Array): LogoContentType | null {
  if (starts(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, 0, ascii('RIFF')) && starts(bytes, 8, ascii('WEBP'))) return 'image/webp';
  return null;
}

/** Null when the bytes are the logo `declared` says (within 2 MB); else why they are refused. */
export function checkLogo(
  declared: LogoContentType,
  bytes: Uint8Array,
): 'UPLOAD_MISMATCH' | 'LOGO_TOO_BIG' | null {
  if (bytes.byteLength > LOGO_LIMITS.maxBytes) return 'LOGO_TOO_BIG';
  return sniffLogoType(bytes) === declared ? null : 'UPLOAD_MISMATCH';
}

/** The extension of a stored logo's key, for its content type. */
export const logoExtension = (type: LogoContentType) =>
  type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';

/** The content type of a stored logo, from its key's extension (the API chose the key). */
export const logoTypeOfKey = (key: string): LogoContentType =>
  key.endsWith('.jpg') ? 'image/jpeg' : key.endsWith('.webp') ? 'image/webp' : 'image/png';

/** The id of a stored logo: the last part of its key, without the extension. */
export const logoIdOf = (key: string) =>
  key.slice(key.lastIndexOf('/') + 1).replace(/\.[a-z]+$/, '');

/**
 * The logo's lasting public address: on the portal's own host, which serves `/api/v1/portal/*`.
 * `v` (the stored file's id) only makes a replaced logo show at once; the route ignores it.
 */
export function logoUrl(
  portalBaseUrl: string,
  slug: string,
  logoKey: string | null | undefined,
  variant: LogoVariant = 'dark',
): string | null {
  if (!logoKey) return null;
  const query = variant === 'light' ? 'variant=light&' : '';
  return `${portalBaseUrl.replace(/\/+$/, '')}/api/v1/portal/${slug}/logo?${query}v=${logoIdOf(logoKey)}`;
}
