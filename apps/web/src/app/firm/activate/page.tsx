import type { Metadata } from 'next';
import { Activation } from '../../../components/auth/activation';

export const metadata: Metadata = { title: 'Activate your account' };

export default function ActivateYourAccountPage() {
  return <Activation />;
}
