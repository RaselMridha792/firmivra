import { z } from 'zod';
import { text } from '../clients/text.js';

// Content (R12): what the firm publishes in its portal: resource pages, tips and external links
// (content_items). Firm routes: /api/v1/business/content (everyone reads; Owner and Admin
// create, edit, publish and delete). Portal routes: /api/v1/portal/{firmSlug}/me/content
// (published items only).
// - RESOURCE: one section of a resource page. `category` is the page's key (RESOURCE_PAGES),
//   `title` the section heading, `body` its markdown (headings, lists and tables; no raw HTML).
// - TIP: a short markdown tip; `category` groups tips (optional).
// - EXTERNAL_LINK: a card that opens an https URL in a new tab. `category` is the section
//   ("IRS & Business Taxes"), `iconKey` the source's icon ("irs", "sba"), never a URL.
// - Business only (System Wiring G): resources and external links belong to "Business Documents
//   & Resources", so an INDIVIDUAL client gets 403 BUSINESS_ONLY for them; tips are for every
//   client. The account type is the firm's (the client record), checked by the API on every read.
// - Unpublished items are hidden from clients; nothing is copied from the linked sites.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export const ContentId = z.uuid();
export const ContentKind = z.enum(['RESOURCE', 'TIP', 'EXTERNAL_LINK']);
export type ContentKind = z.infer<typeof ContentKind>;

/** The portal's resource pages (PAGE-MAP `/{firm}/resources/...`) and their category keys. */
export const RESOURCE_PAGES = [
  'startup-guide',
  'record-keeping',
  'payroll',
  'tax-deductions',
] as const;
/** A resource page key: lower-case words joined by dashes. */
const PageKey = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case words and dashes')
  .max(40);
/** The design-system icon name for a card: "irs", "sba", "fdic", "census", "link"... */
export const IconKey = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use an icon name')
  .max(40);
/** Only https, and nothing a client could be sent to by mistake (no credentials in the URL). */
export const HttpsUrl = z
  .url({ protocol: /^https$/, hostname: z.regexes.domain })
  .max(2000)
  .refine((u) => !/^https:\/\/[^/]*@/.test(u), 'Remove the user name or password from the link');

export const ContentItem = z.object({
  id: z.uuid(),
  kind: ContentKind,
  category: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  /** Markdown, for RESOURCE and TIP. */
  body: z.string().nullable(),
  /** https, for EXTERNAL_LINK. */
  url: z.string().nullable(),
  iconKey: z.string().nullable(),
  sortOrder: z.number().int(),
  /** Null while it is a draft (hidden from clients). */
  publishedAt: DateTime.nullable(),
  updatedAt: DateTime,
});
export type ContentItem = z.infer<typeof ContentItem>;

export const ContentList = z.object({ items: z.array(ContentItem) });
export type ContentList = z.infer<typeof ContentList>;

/** GET /business/content: drafts and published, by category then sortOrder. */
export const ContentQuery = z.strictObject({
  kind: ContentKind.optional(),
  category: z.string().trim().max(80).optional(),
});
export type ContentQuery = z.input<typeof ContentQuery>;

type Fields = {
  kind?: ContentKind | undefined;
  category?: string | null | undefined;
  body?: string | undefined;
  url?: string | undefined;
};
/** What each kind needs: links a URL and no body; resources a page key and a body; tips a body. */
const kindRules = (c: Fields, ctx: z.RefinementCtx) => {
  if (c.kind === 'EXTERNAL_LINK') {
    if (c.url === undefined)
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Add the link' });
    if (c.body !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'Links have no body' });
    }
  } else if (c.kind !== undefined) {
    if (c.body === undefined)
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'Add the text' });
    if (c.url !== undefined)
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Only links have a URL' });
  }
  if (c.kind === 'RESOURCE' && !PageKey.safeParse(c.category).success) {
    ctx.addIssue({ code: 'custom', path: ['category'], message: 'Choose the resource page' });
  }
};

/** Owner and Admin. Created as a draft: publish it to show it to clients. */
export const CreateContentRequest = z
  .strictObject({
    kind: ContentKind,
    category: text(80).optional(),
    title: text(120),
    description: text(300, 'many').optional(),
    body: text(20_000, 'many').optional(),
    url: HttpsUrl.optional(),
    iconKey: IconKey.optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .superRefine(kindRules);
export type CreateContentRequest = z.input<typeof CreateContentRequest>;

/**
 * Owner and Admin; send only what changes (the kind never changes). `null` clears an optional
 * field. The API checks the result against the same rules (a link keeps its URL).
 */
export const UpdateContentRequest = z
  .strictObject({
    category: text(80).nullable().optional(),
    title: text(120).optional(),
    description: text(300, 'many').nullable().optional(),
    body: text(20_000, 'many').optional(),
    url: HttpsUrl.optional(),
    iconKey: IconKey.nullable().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateContentRequest = z.input<typeof UpdateContentRequest>;

// ---------- Portal ----------
/** What a client sees: published items only, without the internal dates. */
export const MyContentItem = ContentItem.omit({ publishedAt: true, updatedAt: true });
export type MyContentItem = z.infer<typeof MyContentItem>;

export const MyContentList = z.object({ items: z.array(MyContentItem) });
export type MyContentList = z.infer<typeof MyContentList>;

/**
 * GET /portal/{firmSlug}/me/content: by category then sortOrder. For an INDIVIDUAL client,
 * `kind` RESOURCE or EXTERNAL_LINK is 403 BUSINESS_ONLY, and a list without `kind` holds only tips.
 */
export const MyContentQuery = z.strictObject({
  kind: ContentKind.optional(),
  category: z.string().trim().max(80).optional(),
});
export type MyContentQuery = z.input<typeof MyContentQuery>;

// ---------- Errors ----------
export const ContentErrorCode = z.enum([
  /** 403: resources and external links are for business clients (System Wiring G). */
  'BUSINESS_ONLY',
]);
export type ContentErrorCode = z.infer<typeof ContentErrorCode>;
