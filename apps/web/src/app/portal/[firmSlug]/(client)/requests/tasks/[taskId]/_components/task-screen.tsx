'use client';

import { ApiRequestError, DOCUMENT_ERRORS } from '@firmivra/types';
import { Badge, Button, Card, Skeleton } from '@firmivra/ui';
import { ArrowLeft, CheckCircle2, ChevronRight, Circle, FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../../lib/query';
import { MY_TASK_LABELS, MY_TASK_TONES, taskDue } from '../../../../_components/my-task-shared';

/**
 * Client Portal Review One T16: one task the firm shows this client. Only what the firm approved:
 * the title, its instructions, where it stands, the due date, the checklist and the files approved
 * for the client (opened through My Documents' own download). Nothing here changes the task.
 */
export function TaskScreen() {
  const { firmSlug: slug, taskId } = useParams<{ firmSlug: string; taskId: string }>();
  const task = useApiQuery(['my-tasks', slug, taskId], () => api.myTasks(slug).get(taskId));
  const download = useApiMutation((id: string) => api.myDocuments(slug).download(id));
  const [problem, setProblem] = useState<string | null>(null);
  const t = task.data;
  const back = `/${slug}/documents`;

  if (task.isError && task.error instanceof ApiRequestError && task.error.status === 404)
    return (
      <Card
        className="flex flex-col items-center gap-3 p-8! text-center"
        data-testid="task-missing"
      >
        <h1 className="font-display text-2xl font-bold text-heading">
          This task isn&apos;t available
        </h1>
        <p className="text-text">Your firm may have finished or withdrawn it.</p>
        <Link href={back} className="font-semibold text-action">
          Back to Requests
        </Link>
      </Card>
    );

  const open = (id: string) => {
    setProblem(null);
    download.mutate(id, {
      onSuccess: (link) => window.open(link.url, '_blank', 'noopener'),
      onError: (e) => setProblem(errorMessage(e, DOCUMENT_ERRORS)),
    });
  };
  const due = t ? taskDue(t) : null;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="client-task">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-text">
        <Link href={back} className="hover:text-action">
          Documents
        </Link>
        <ChevronRight aria-hidden className="size-4 text-muted" />
        <Link href={back} className="hover:text-action">
          Requests
        </Link>
        <ChevronRight aria-hidden className="size-4 text-muted" />
        <span aria-current="page" className="text-action">
          {t?.title ?? 'Task'}
        </span>
      </nav>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {t ? (
            <>
              <h1 className="font-display text-3xl font-bold text-heading">{t.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-text">
                <Badge tone={MY_TASK_TONES[t.status]}>{MY_TASK_LABELS[t.status]}</Badge>
                {due ? <span>Due {due}</span> : <span className="text-muted">No due date</span>}
              </div>
            </>
          ) : task.isError ? (
            <p role="alert" className="text-danger">
              {errorMessage(task.error)}
            </p>
          ) : (
            <Skeleton className="h-9 w-72" />
          )}
        </div>
        <Link
          href={back}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-action px-4 font-semibold text-action hover:bg-info-soft"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Requests
        </Link>
      </header>

      {t ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="flex flex-col gap-3 p-5! lg:col-span-2" data-testid="task-details">
            <h2 className="text-xl font-bold text-heading">What to do</h2>
            <p className="whitespace-pre-line text-text">
              {t.details || 'Your firm added no instructions to this task.'}
            </p>
            {t.checklistItems.length ? (
              <>
                <h3 className="mt-2 font-semibold text-heading">
                  Checklist ({t.checklist.done} of {t.checklist.total} done)
                </h3>
                <ul className="grid gap-2" data-testid="task-checklist">
                  {t.checklistItems.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 text-text">
                      {item.done ? (
                        <CheckCircle2 aria-hidden className="size-5 text-success" />
                      ) : (
                        <Circle aria-hidden className="size-5 text-muted" />
                      )}
                      <span>{item.label}</span>
                      <span className="sr-only">{item.done ? '(done)' : '(not done yet)'}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
          <Card className="flex flex-col gap-3 p-5!" data-testid="task-files">
            <h2 className="text-xl font-bold text-heading">Files from your firm</h2>
            {problem ? (
              <p role="alert" className="text-sm text-danger">
                {problem}
              </p>
            ) : null}
            {t.attachments.length ? (
              <ul className="grid gap-2">
                {t.attachments.map((a) => (
                  <li key={a.documentId} className="flex items-center gap-2">
                    <FileText aria-hidden className="size-5 shrink-0 text-action" />
                    <span className="min-w-0 flex-1 truncate text-text">{a.fileName}</span>
                    <Button
                      variant="secondary"
                      onClick={() => open(a.documentId)}
                      disabled={download.isPending}
                      aria-label={`Download ${a.fileName}`}
                    >
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No files are shared with this task.</p>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
