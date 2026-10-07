import { Applications } from '../../../../../features/platform';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Applications id={id} />;
}
