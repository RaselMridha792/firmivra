import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'My Profile' };

export default function MyProfilePage() {
  return (
    <PagePlaceholder
      title="My Profile"
      ticket="N05"
      owner="Nahid"
      mockup="client-portal/My profile.png"
    />
  );
}
