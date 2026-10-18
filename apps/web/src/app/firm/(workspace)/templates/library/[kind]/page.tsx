import type { Metadata } from 'next';
import { LibraryScreen } from '../../_components/library-screen';

export const metadata: Metadata = { title: 'Template library' };

type Props = { params: Promise<{ kind: string }> };

export default async function TemplateLibraryPage({ params }: Props) {
  const { kind } = await params;
  return <LibraryScreen key={kind} slug={kind} />;
}
