import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Sign up' };

export default function SignUpPage() {
  return (
    <PagePlaceholder
      title="Sign up"
      ticket="N02"
      owner="Nahid"
      mockup="client-portal/LVP Client Portal Sign-Up Page.png"
    />
  );
}
