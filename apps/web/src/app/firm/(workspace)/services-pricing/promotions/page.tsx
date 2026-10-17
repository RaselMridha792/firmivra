import type { Metadata } from 'next';
import { PromotionsScreen } from '../_components/promotions-screen';

export const metadata: Metadata = { title: 'Services & pricing: Discounts & promotions' };

export default function ServicesPricingPromotionsPage() {
  return <PromotionsScreen />;
}
