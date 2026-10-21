import type { Metadata } from 'next';
import { ReviewScreen } from './_components/review-screen';

export const metadata: Metadata = { title: 'Review & E-File' };

export default async function TaxReturnReviewPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  const { returnId } = await params;
  return <ReviewScreen returnId={returnId} />;
}
