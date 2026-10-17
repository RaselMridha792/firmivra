import type { Metadata } from 'next';
import { CategoriesScreen } from '../_components/categories-screen';

export const metadata: Metadata = { title: 'Services & pricing: Categories' };

export default function ServicesPricingCategoriesPage() {
  return <CategoriesScreen />;
}
