import type { Metadata } from 'next';
import { Activate } from '../../../components/auth/activate';

export const metadata: Metadata = { title: 'Activate your account' };

export default function ActivateYourAccountPage() {
  return <Activate />;
}
