import type { Metadata } from 'next';
import { IntakePage } from '../_blocks/intake-flow';
import styles from '../_blocks/intake-scale.module.css';

export const metadata: Metadata = { title: 'Tax planning' };

export default async function TaxPlanningPage({
  params,
}: {
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  return <IntakePage firmSlug={firmSlug} form="TAX_PLANNING" className={styles.scale} />;
}
