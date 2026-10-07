import { FutureModule } from '../../../../../features/platform';
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <FutureModule title={slug.replace(/-/g, ' ')} />;
}
