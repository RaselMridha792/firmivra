import { PageContainer } from '@firmivra/ui';
import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Resume your form' };

export default function ResumeYourFormPage() {
  return (
    <PageContainer className="py-8">
      <PagePlaceholder title="Resume your form" ticket="N07c" owner="Arfan" />
    </PageContainer>
  );
}
