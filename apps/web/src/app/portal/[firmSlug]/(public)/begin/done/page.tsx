import type { Metadata } from 'next';
import { DoneScreen } from './_components/done-screen';

export const metadata: Metadata = { title: 'Thank you' };

export default async function ThankYouPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmSlug: string }>;
  searchParams: Promise<{ form?: string | string[] }>;
}) {
  const { firmSlug } = await params;
  const { form } = await searchParams;
  return <DoneScreen firmSlug={firmSlug} formPath={typeof form === 'string' ? form : ''} />;
}
