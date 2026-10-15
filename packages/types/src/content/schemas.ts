import { z } from 'zod';
import { clearable, text } from '../clients/text.js';

// Content (R12): what the firm publishes in its portal: resource pages, tips and external links
// (content_items). Firm routes: /api/v1/business/content (everyone reads; Owner and Admin
// create, edit, publish and delete). Portal routes: /api/v1/portal/{firmSlug}/me/content
// (published items only).
// - RESOURCE: one section of a resource page. `category` is the page's key (ResourcePage),
//   `title` the section heading, `body` its markdown.
// - TIP: a short markdown tip; `category` groups tips (optional).
// - Markdown is shown with R1's shared renderer: headings, lists, tables, emphasis; raw HTML off,
//   images off, and links only to https: or mailto: (anything else is shown as text).
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
/** A RESOURCE item's `category`: one of the resource pages. */
export const ResourcePage = z.enum(RESOURCE_PAGES);
export type ResourcePage = z.infer<typeof ResourcePage>;
/** The design-system icon name for a card: "irs", "sba", "fdic", "census", "link"... */
export const IconKey = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use an icon name')
  .max(40);
/**
 * An https link to a domain name (never an IP address or localhost), normalized ("HTTPS://IRS.GOV"
 * becomes "https://irs.gov/", spaces become %20), with no user name or password in it.
 */
export const HttpsUrl = z
  // abort: the checks below parse the link again, which throws on one that is not a URL.
  .url({ protocol: /^https$/, hostname: z.regexes.domain, normalize: true, abort: true })
  .max(2000)
  .refine((u) => {
    const url = new URL(u);
    return url.username === '' && url.password === '';
  }, 'Remove the user name or password from the link');

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
  body?: string | null | undefined;
  url?: string | null | undefined;
};
/**
 * What each kind needs: links a URL and no body; resources one of the resource pages and a
 * body; tips a body. Returns each problem's field and message.
 */
function kindProblems(c: Fields): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  if (c.kind === 'EXTERNAL_LINK') {
    if (c.url == null) problems.push({ path: 'url', message: 'Add the link' });
    if (c.body != null) problems.push({ path: 'body', message: 'Links have no body' });
  } else if (c.kind !== undefined) {
    if (c.body == null) problems.push({ path: 'body', message: 'Add the text' });
    if (c.url != null) problems.push({ path: 'url', message: 'Only links have a URL' });
  }
  if (c.kind === 'RESOURCE' && !ResourcePage.safeParse(c.category).success) {
    problems.push({ path: 'category', message: 'Choose the resource page' });
  }
  return problems;
}

/**
 * The first problem with an item for its kind, or null. The API (and the mock) check an edited
 * item with it, since an update sends only the changed fields.
 */
export const contentKindProblem = (c: Fields): string | null => kindProblems(c)[0]?.message ?? null;

const contentKindRules = (c: Fields, ctx: z.RefinementCtx) => {
  for (const { path, message } of kindProblems(c)) {
    ctx.addIssue({ code: 'custom', path: [path], message });
  }
};

/** Owner and Admin. Created as a draft: publish it to show it to clients. */
export const CreateContentRequest = z
  .strictObject({
    kind: ContentKind,
    category: clearable(text(80)),
    title: text(120),
    description: clearable(text(300, 'many')),
    body: clearable(text(20_000, 'many')),
    url: clearable(HttpsUrl),
    iconKey: IconKey.optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .superRefine(contentKindRules);
export type CreateContentRequest = z.input<typeof CreateContentRequest>;

/**
 * Owner and Admin; send only what changes (the kind never changes). `null` clears an optional
 * field. The API checks the result against the same rules (a link keeps its URL).
 */
export const UpdateContentRequest = z
  .strictObject({
    category: clearable(text(80)),
    title: text(120).optional(),
    description: clearable(text(300, 'many')),
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
