import type { Metadata } from 'next';
import { ResumeScreen } from './_components/resume-screen';

export const metadata: Metadata = { title: 'Resume your form' };

export default async function ResumeYourFormPage({
  params,
}: {
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  return <ResumeScreen firmSlug={firmSlug} />;
}
