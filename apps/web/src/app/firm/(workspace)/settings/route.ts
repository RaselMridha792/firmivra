// /settings opens Profile (docs/junior/PAGE-MAP.md). Only this exact path: 307 to a fixed path on
// this site, with a relative Location and no query. A route handler, because Next's proxy turns a
// relative Location into a 500 (docs/work/R1-cicd.md, Oct 8).
export function GET() {
  return new Response(null, { status: 307, headers: { Location: '/settings/profile' } });
}
