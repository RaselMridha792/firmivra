import type { Metadata } from 'next';
import { RolesScreen } from './_components/roles-screen';

export const metadata: Metadata = { title: 'Roles & permissions' };

/** Create Staff's own pages only: Back never leaves the wizard (no open redirect). */
const safeBack = (back: string | undefined) =>
  back && /^\/team\/new(\/[a-z]+)?(\?draft=[0-9a-f-]{36})?$/.test(back) ? back : undefined;

export default async function TeamRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; back?: string }>;
}) {
  // Create Staff's Create Custom Role (Octavia's SM11): open the dialog, and offer Back to it.
  const { create, back } = await searchParams;
  return (
    <RolesScreen
      startCustom={create === 'custom'}
      back={typeof back === 'string' ? safeBack(back) : undefined}
    />
  );
}
