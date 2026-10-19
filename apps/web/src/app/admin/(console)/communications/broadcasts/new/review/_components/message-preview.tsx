import { Bell } from '@phosphor-icons/react';
import Image from 'next/image';
import logo from '../../../../../../../../components/app-shell/firmivra-logo.png';

export type ReviewChannel = 'EMAIL' | 'SMS' | 'IN_APP';

/** What Review & Send shows: the broadcast as saved, with step 1's choices B6 does not keep. */
export interface ReviewView {
  name: string;
  category: string;
  description: string;
  createdBy: string;
  audience: string;
  /** People the segment reaches now; null until it is counted. */
  recipients: number | null;
  filters: string;
  uploadedList: string;
  channels: ReviewChannel[];
  messageSummary: string;
  scheduledLabel: string;
  contents: Partial<Record<ReviewChannel, { subject: string | null; body: string }>>;
}

interface MessagePreviewProps {
  review: ReviewView | null;
  channel?: string;
  compact?: boolean;
}

/** Each channel's saved content, as recipients will read it (merge fields are filled per person). */
export function MessagePreview({
  review,
  channel = 'EMAIL',
  compact = false,
}: MessagePreviewProps) {
  const content = review?.contents[channel as ReviewChannel];
  if (!review || !content) {
    return (
      <div className="flex min-h-96 items-center justify-center rounded-control border border-border p-6 text-center text-sm text-muted">
        No message to preview.
      </div>
    );
  }

  if (channel === 'SMS') {
    return (
      <div className="min-h-96 rounded-control border border-border bg-canvas p-5">
        <p className="mb-5 text-center text-sm font-semibold text-heading">Firmivra</p>
        <p className="whitespace-pre-wrap rounded-xl bg-surface p-4 text-sm text-text shadow-sm">
          {content.body}
        </p>
        <p className="mt-3 text-center text-xs text-muted">SMS preview</p>
      </div>
    );
  }

  if (channel === 'IN_APP') {
    return (
      <div className="min-h-96 rounded-control border border-border bg-canvas p-4">
        <div className="flex gap-3 rounded-control border border-border bg-surface p-4">
          <Bell weight="fill" aria-hidden className="size-6 shrink-0 text-action" />
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-bold text-heading">{review.name}</p>
            <p className="whitespace-pre-wrap text-sm text-muted">{content.body}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-control border border-border bg-surface p-5 text-heading">
      <Image src={logo} alt="Firmivra" className="mx-auto mb-3 h-auto w-28" sizes="112px" />
      <h3 className="mb-3 text-base font-extrabold">{content.subject}</h3>
      <p className="whitespace-pre-wrap text-xs leading-relaxed">{content.body}</p>
      {!compact && (
        <p className="mt-4 border-t border-border pt-4 text-center text-xs leading-relaxed text-muted">
          Sent by Firmivra
        </p>
      )}
    </div>
  );
}
