import type { Metadata } from 'next';
import { ServicesScreen } from './_components/services-screen';

export const metadata: Metadata = { title: 'My Services' };

export default function MyServicesPage() {
  return <ServicesScreen />;
}
