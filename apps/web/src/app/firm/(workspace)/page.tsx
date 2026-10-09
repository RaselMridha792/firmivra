import type { Metadata } from 'next';
import { Card } from '@firmivra/ui';
import {
  CircleCheck,
  ClipboardList,
  FileCheck,
  FileSearch,
  FolderCheck,
  FolderMinus,
  PenLine,
  Receipt,
  UserPlus,
} from 'lucide-react';

export const metadata: Metadata = { title: 'Dashboard' };

const queues = [
  { title: 'New clients', icon: UserPlus },
  { title: 'Missing documents', icon: FolderMinus },
  { title: 'Preparation', icon: ClipboardList },
  { title: 'Review', icon: FileSearch },
  { title: 'Signature', icon: PenLine },
  { title: 'Payment', icon: Receipt },
  { title: 'Filing', icon: FileCheck },
  { title: 'Completed', icon: FolderCheck },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6" data-testid="firm-dashboard">
      <div>
        <h1 className="text-3xl font-semibold text-heading">Dashboard</h1>
        <p className="mt-2 text-muted">Your firm's work queues.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {queues.map(({ title, icon: Icon }) => (
          <Card
            key={title}
            title={
              <span className="flex items-center gap-3">
                <span className="rounded-control bg-brand-50 p-3 text-brand-600">
                  <Icon aria-hidden className="size-6" />
                </span>
                {title}
              </span>
            }
            data-testid="work-queue"
          >
            <div className="flex items-start gap-2 text-sm text-muted">
              <CircleCheck aria-hidden className="mt-1 size-4 shrink-0" />
              <p>No items in this queue yet.</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
