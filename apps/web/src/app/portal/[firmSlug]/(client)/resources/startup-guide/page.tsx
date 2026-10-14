import type { Metadata } from 'next';
import { StartupGuideScreen } from './_components/startup-guide-screen';

export const metadata: Metadata = { title: 'Business Startup Guide' };

export default function Page() {
  return <StartupGuideScreen />;
}
