/** The same rule as PORTAL_SLUG in src/proxy.ts, which answers 404 before any other slug gets here. */
const SLUG = /^[A-Za-z0-9-]{1,63}$/;

// /{slug}/home opens the Intake Form tab (docs/junior/PAGE-MAP.md). Only this exact path: 307 to
// /{slug}/intake on this site, with a relative Location built from the checked slug, no query.
// The firm isn't looked up here: a well-formed slug that is no firm also goes to /{slug}/intake
// on this site, as the old home page did, and the portal layout shows not-found there.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ firmSlug: string }> },
) {
  const { firmSlug } = await params;
  if (!SLUG.test(firmSlug)) return new Response(null, { status: 404 });
  return new Response(null, { status: 307, headers: { Location: `/${firmSlug}/intake` } });
}
