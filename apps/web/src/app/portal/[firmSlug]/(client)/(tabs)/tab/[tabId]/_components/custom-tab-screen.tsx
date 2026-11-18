'use client';

import type { MyCustomTab } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { CloudUpload, FolderUp } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../../../components/page-state';
import { api } from '../../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../../lib/query';
import { usePortal } from '../../../../../layout';
import { usePortalCustomTab } from '../../../../_components/portal-tabs';
import { BusinessScreen } from '../../../business/_components/business-screen';
import { DocumentTable } from '../../../documents/_components/documents-screen';
import { UploadDialog } from '../../../documents/_components/upload-dialog';

/**
 * CP-5d, CP-5e: a tab the firm added, under its own name. A document tab uploads files that keep
 * the tab and lists the client's files sent through it; a resources tab shows the business
 * resources. A tab the client doesn't see (off, archived, not for them) says so, also by link.
 */
export function CustomTabScreen() {
  const { firmSlug: slug, tabId } = useParams<{ firmSlug: string; tabId: string }>();
  const { query, tab } = usePortalCustomTab(slug, tabId);
  return (
    <PageState query={query}>
      {() =>
        !tab ? (
          <Unavailable />
        ) : tab.module === 'DOCUMENTS' ? (
          <TabDocuments slug={slug} tab={tab} />
        ) : (
          <BusinessScreen title={tab.label} />
        )
      }
    </PageState>
  );
}

function Unavailable() {
  const { business } = usePortal();
  return (
    <Card role="status">
      <h1 className="font-display text-xl font-bold text-heading">This tab isn&apos;t available</h1>
      <p className="mt-2 text-sm text-text">
        {business.name} doesn&apos;t show this part of the portal to you. Nothing you shared with
        them is removed.
      </p>
    </Card>
  );
}

function TabDocuments({ slug, tab }: { slug: string; tab: MyCustomTab }) {
  const { business } = usePortal();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const list = useApiQuery(['my-documents', slug, 'tab', tab.id], () =>
    api.myDocuments(slug).list({ source: 'MINE', portalTabId: tab.id, limit: 100 }),
  );
  return (
    <Card className="grid min-w-0 grid-cols-1 gap-4">
      <header className="flex flex-col gap-4 md:flex-row md:items-start">
        <FolderUp
          aria-hidden
          className="size-16 shrink-0 rounded-full bg-folder-surface p-4 text-firm-text"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-bold break-words text-heading">{tab.label}</h1>
          <p className="text-text">
            Upload files for {business.name} here. They also show in My Uploaded Documents.
          </p>
        </div>
        <Button
          onClick={() => setUploading(true)}
          className="bg-firm-button! hover:bg-firm-button-hover!"
        >
          <CloudUpload aria-hidden className="size-5" /> Upload Documents
        </Button>
      </header>
      {uploaded ? (
        <p role="status" className="rounded-card bg-success-soft p-3 text-sm text-success">
          {uploaded} was uploaded. We&apos;re checking it now; you can download it once that is
          done.
        </p>
      ) : null}
      <PageState query={list}>
        {(data) => <DocumentTable slug={slug} rows={data.items} firm={false} />}
      </PageState>
      <UploadDialog
        slug={slug}
        open={uploading}
        portalTabId={tab.id}
        onClose={() => setUploading(false)}
        onUploaded={setUploaded}
      />
    </Card>
  );
}
