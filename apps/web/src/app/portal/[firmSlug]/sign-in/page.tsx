import { SignInPanel } from '../../../../components/sign-in-panel';

export default async function PortalSignIn({ params }: { params: Promise<{ firmSlug: string }> }) {
  const { firmSlug } = await params;
  return (
    <SignInPanel title={`Client portal: ${firmSlug}`} pool="CLIENT" homePath={`/${firmSlug}`} />
  );
}
