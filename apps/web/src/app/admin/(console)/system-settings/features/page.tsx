import type { Metadata } from 'next';
import { FeatureManagement } from './_components/feature-management';

export const metadata: Metadata = { title: 'Feature management' };

export default function FeatureManagementPage() {
  return <FeatureManagement />;
}
