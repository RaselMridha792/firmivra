import type { Metadata } from 'next';
import { PageContainer } from '@firmivra/ui';
import { BrandLockup } from '../../../../components/app-shell/brand-lockup';
import { RespondScreen } from './_components/respond-screen';

export const metadata: Metadata = { title: 'Answer a request' };

/**
 * /apply/respond#token=…: the applicant's answer to a request for more information (SA-APP-F04),
 * signed out. The emailed link's token stays in the fragment, out of logs and Referer.
 */
export default function RespondPage() {
  return (
    <main className="flex min-h-screen flex-col bg-canvas py-8">
      <PageContainer className="flex flex-1 flex-col">
        <BrandLockup subtitle="Firm application" />
        <div className="mx-auto flex w-full max-w-2xl flex-1 items-start py-8">
          <RespondScreen />
        </div>
      </PageContainer>
    </main>
  );
}
