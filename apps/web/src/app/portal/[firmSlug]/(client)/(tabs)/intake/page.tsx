import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Intake Form' };

export default function IntakeFormPage() {
  return (
    <PagePlaceholder
      title="Intake Form"
      ticket="N06"
      owner="Nahid"
      mockup="client-portal/Intake form tab.png"
    />
  );
}
