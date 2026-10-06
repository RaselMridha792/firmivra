import { Clients } from '../../../../../features/directories';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Clients id={id} />;
}
