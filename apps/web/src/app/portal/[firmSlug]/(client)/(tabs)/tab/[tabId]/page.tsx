import type { Metadata } from 'next';
import { CustomTabScreen } from './_components/custom-tab-screen';

export const metadata: Metadata = { title: 'My Client Portal' };

/** CP-5d, CP-5e: a tab the firm added (Settings > Client Portal > Features > Custom Tabs). */
export default function CustomTabPage() {
  return <CustomTabScreen />;
}
