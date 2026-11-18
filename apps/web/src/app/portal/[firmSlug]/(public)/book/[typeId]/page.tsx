import type { Metadata } from 'next';
import { BookLinkScreen } from './_components/book-link-screen';

export const metadata: Metadata = { title: 'Book an appointment' };

type Props = {
  params: Promise<{ typeId: string }>;
  searchParams: Promise<{ package?: string | string[] }>;
};

/**
 * /{firm}/book/{typeId} (Appointments Review 2, row 3): the page behind an appointment type's
 * booking link and its website button. It opens booking on that exact type. `?package=` (S12): a
 * package page's Book, so the booking names the package for the firm.
 */
export default async function BookLinkPage({ params, searchParams }: Props) {
  const { typeId } = await params;
  const { package: pkg } = await searchParams;
  return <BookLinkScreen typeId={typeId} packageId={typeof pkg === 'string' ? pkg : undefined} />;
}
