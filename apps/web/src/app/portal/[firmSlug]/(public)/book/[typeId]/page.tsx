import type { Metadata } from 'next';
import { BookLinkScreen } from './_components/book-link-screen';

export const metadata: Metadata = { title: 'Book an appointment' };

type Props = { params: Promise<{ typeId: string }> };

/**
 * /{firm}/book/{typeId} (Appointments Review 2, row 3): the page behind an appointment type's
 * booking link and its website button. It opens booking on that exact type.
 */
export default async function BookLinkPage({ params }: Props) {
  const { typeId } = await params;
  return <BookLinkScreen typeId={typeId} />;
}
