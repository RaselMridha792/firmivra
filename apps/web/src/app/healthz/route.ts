// GET /healthz: liveness for the load balancer and the e2e test runner (identifies this app).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ app: 'firmivra-web', status: 'ok' });
}
