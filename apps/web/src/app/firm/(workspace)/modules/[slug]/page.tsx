import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findModule } from '../../../../../lib/firm-modules';
import { ModuleCard } from './_components/module-card';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const mod = findModule((await params).slug);
  return { title: mod?.label ?? 'Module' };
}

/** The one page every module that is not built yet opens (src/lib/firm-modules.ts). */
export default async function ModulePage({ params }: Params) {
  const mod = findModule((await params).slug);
  if (!mod) notFound();
  return <ModuleCard label={mod.label} icon={mod.icon} />;
}
