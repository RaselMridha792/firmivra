import type { Metadata } from 'next';
import { SharedIntakePage } from '../../begin/_blocks/intake-flow';
import styles from '../../begin/_blocks/intake-scale.module.css';

export const metadata: Metadata = { title: 'Intake form' };

/** A shared intake form (INTAKE-ACCESS-02): the firm's link to one published form, for anyone. */
export default async function SharedFormPage({
  params,
}: {
  params: Promise<{ firmSlug: string; token: string }>;
}) {
  const { firmSlug, token } = await params;
  return <SharedIntakePage firmSlug={firmSlug} token={token} className={styles.scale} />;
}
