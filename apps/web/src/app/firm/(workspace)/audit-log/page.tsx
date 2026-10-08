import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Audit log' };

export default function AuditLogPage() {
  return <PagePlaceholder title="Audit log" ticket="F12" owner="Tumit" />;
}
