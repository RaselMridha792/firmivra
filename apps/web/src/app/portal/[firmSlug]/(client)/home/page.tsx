import { redirect } from 'next/navigation';

// /{firm}/home opens the Intake Forms tab (docs/junior/PAGE-MAP.md).
export default async function PortalHome({ params }: { params: Promise<{ firmSlug: string }> }) {
  const { firmSlug } = await params;
  redirect(`/${firmSlug}/intake`);
}
