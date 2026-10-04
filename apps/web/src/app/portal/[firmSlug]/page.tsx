import { SessionPanel } from '../../../components/session-panel';

export default async function PortalHome({ params }: { params: Promise<{ firmSlug: string }> }) {
  const { firmSlug } = await params;
  return (
    <SessionPanel
      title="Client portal"
      signInPath={`/${firmSlug}/sign-in`}
      firm={{ kind: 'portal', slug: firmSlug }}
    />
  );
}
