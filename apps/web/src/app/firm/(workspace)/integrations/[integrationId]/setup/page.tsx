import { redirect } from 'next/navigation';

/**
 * Where the API's OAuth callback sends the browser back (`/integrations/{provider}/setup?result=
 * connected|failed`, R55): the connect flow's last step, which reads the result.
 */
export default async function IntegrationSetupReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ integrationId: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { integrationId } = await params;
  const { result } = await searchParams;
  const outcome = result === 'connected' || result === 'failed' ? `?result=${result}` : '';
  redirect(`/integrations/${encodeURIComponent(integrationId)}/connect/complete${outcome}`);
}
