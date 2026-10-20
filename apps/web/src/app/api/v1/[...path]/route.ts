// /api/v1/*: forwarded to the API in local development (src/lib/api-forward.ts); 404 without
// API_BASE_URL. In AWS, CloudFront sends /api/* to the API and this route is never reached.
import { forwardToApi } from '../../../../lib/api-forward';

export const dynamic = 'force-dynamic';

const forward = (request: Request) => forwardToApi(request, process.env['API_BASE_URL']);

export {
  forward as DELETE,
  forward as GET,
  forward as HEAD,
  forward as OPTIONS,
  forward as PATCH,
  forward as POST,
  forward as PUT,
};
