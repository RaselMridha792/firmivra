import type { Metadata } from 'next';
import { StrategyLibrary } from '../_components/tp-lists';

export const metadata: Metadata = { title: 'Strategies & Recommendations' };

export default function Page() {
  return <StrategyLibrary />;
}
