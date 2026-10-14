'use client';

import { Card } from '@firmivra/ui';
import {
  CheckCircle,
  Envelope,
  Eye,
  UploadSimple,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';

/**
 * A real, firm-wide feed: GET /business/audit-log (api.auditLog), the only firm-wide route this
 * data has (R34 PR). Owner/Admin only (FIRM_MANAGERS, same as the Audit log nav item) — Staff get
 * a quiet line instead of the 403 card PageState would otherwise show. Sentences are built from
 * the real actor name, action and time; never a fabricated file name (audit metadata holds ids and
 * hashes, not file names, per CLAUDE.md rule 4).
 */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function describe(action: string, metadata: Record<string, unknown>, actorName: string) {
  const scanStatus = typeof metadata.scanStatus === 'string' ? metadata.scanStatus : null;
  switch (action) {
    case 'document.uploaded':
      return { Icon: UploadSimple, tone: 'danger', text: `${actorName} uploaded a document` };
    case 'document.scanned':
      return scanStatus === 'CLEAN'
        ? { Icon: CheckCircle, tone: 'success', text: 'A document was verified' }
        : { Icon: WarningCircle, tone: 'danger', text: 'A document scan needs attention' };
    case 'document_request.created':
      return { Icon: Envelope, tone: 'danger', text: `${actorName} sent a document request` };
    case 'document_request.submitted':
      return {
        Icon: UploadSimple,
        tone: 'info',
        text: `${actorName} submitted a requested document`,
      };
    case 'document.download_link_issued':
      return { Icon: Eye, tone: 'info', text: `${actorName} downloaded a document` };
    default:
      return { Icon: Eye, tone: 'info', text: `${actorName} viewed a document` };
  }
}
const TONE_BG: Record<string, string> = {
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

export function RecentActivityCard() {
  const { role } = useFirm();
  const isManager = role === 'OWNER' || role === 'ADMIN';
  const activity = useQuery({
    queryKey: ['documents', 'recent-activity'],
    queryFn: () => api.auditLog.list({ entityType: 'document', limit: 4 }),
    enabled: isManager,
  });

  return (
    <Card className="p-4" data-testid="recent-activity-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-heading">Recent Activity</h2>
        {isManager ? (
          <Link href="/audit-log" className="text-sm font-semibold text-link underline">
            View All
          </Link>
        ) : null}
      </div>
      {!isManager ? (
        <p className="text-sm text-muted" data-testid="recent-activity-restricted">
          Only the firm&apos;s Owner and Admins can see this.
        </p>
      ) : activity.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : activity.isError ? (
        <p className="text-sm text-muted">Activity isn&apos;t available right now.</p>
      ) : activity.data.items.length === 0 ? (
        <p className="text-sm text-muted">No document activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {activity.data.items.map((entry) => {
            const actorName = entry.actor?.name ?? 'Someone';
            const { Icon, tone, text } = describe(entry.action, entry.metadata, actorName);
            return (
              <li key={entry.id} className="flex items-start gap-3">
                <span
                  className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${TONE_BG[tone]}`}
                >
                  <GlyphIcon icon={Icon} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-heading">{text}</span>
                  <span className="block text-xs text-muted">{relativeTime(entry.at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function GlyphIcon({ icon: Glyph }: { icon: Icon }) {
  return <Glyph weight="fill" className="size-5" aria-hidden="true" />;
}
