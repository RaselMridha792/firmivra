import { StripeOnboardingReturn } from '@firmivra/types';
import type { Metadata } from 'next';
import { PaymentsScreen } from './_components/payments-screen';

// Settings > Payments (R7): the firm's Stripe Connect setup. Stripe sends the Owner back here with
// ?stripe=return or ?stripe=refresh; anything else reads as no return.
export const metadata: Metadata = { title: 'Payments' };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stripe } = StripeOnboardingReturn.parse(await searchParams);
  return <PaymentsScreen stripe={stripe} />;
}
