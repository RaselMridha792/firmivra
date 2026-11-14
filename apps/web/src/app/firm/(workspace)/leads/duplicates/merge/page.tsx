import type { Metadata } from 'next';
import { MergeScreen } from './_components/merge-screen';

export const metadata: Metadata = { title: 'Compare and Merge Leads' };

type Param = string | string[] | undefined;
const one = (v: Param) => (typeof v === 'string' && v.length <= 64 ? v : '');

/** `?a=&b=`: the two leads, from Review Duplicates or a lead's duplicate warning. */
export default async function MergeLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: Param; b?: Param }>;
}) {
  const { a, b } = await searchParams;
  return <MergeScreen a={one(a)} b={one(b)} />;
}
