'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMe } from '../../../../../components/signed-in';
import { Button, Card } from '@firmivra/ui';
import { addNote, decide, type Action, type Application } from './application-data';
import { dateText, StatusPill } from './application-ui';

export function ApplicationDetail({ application: initial }: { application: Application }) {
  const { me } = useMe(),
    [app, setApp] = useState(initial),
    [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const emptySections: [string, string[], string][] = [
    ['Documents Submitted', app.documents, 'No documents uploaded.'],
    ['Automated Checks', app.checks, 'No automated checks returned by mock data.'],
  ];
  if (!me.platformAdmin)
    return <p role="alert">You do not have permission to review firm applications.</p>;
  async function saveNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      setApp(await addNote(app.id, note.trim()));
      setNote('');
    } catch {
      setError('The note could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  async function runAction(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action || busy) return;
    const detail = new FormData(e.currentTarget).get('detail')?.toString().trim() ?? '';
    if (action !== 'Approve' && !detail) return;
    setBusy(true);
    setError('');
    try {
      setApp(await decide(app.id, action, detail));
      setAction(null);
    } catch {
      setError('The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <Link href="/applications" className="w-fit text-sm font-medium text-brand-700">
        ← Back to Applications
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span data-testid="page-title" className="sr-only">
            Firm application
          </span>
          <h1 className="font-serif text-3xl font-semibold">{app.name}</h1>
          <div className="mt-2 flex items-center gap-3">
            <StatusPill status={app.status} />
            <span className="text-sm text-muted">Submitted {dateText(app.submittedAt)}</span>
          </div>
        </div>
        {(app.status === 'Pending Review' || app.status === 'Information Requested') && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAction('Approve')}>Approve application</Button>
            <Button variant="secondary" onClick={() => setAction('Request Information')}>
              Request information
            </Button>
            <Button variant="ghost" className="text-danger" onClick={() => setAction('Decline')}>
              Decline application
            </Button>
          </div>
        )}
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        {Object.entries(app.sections).map(([title, fields]) => (
          <Card key={title}>
            <h2 className="text-lg font-semibold">{title}</h2>
            <dl className="mt-4 divide-y divide-border">
              {Object.entries(fields).map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[minmax(7rem,.8fr)_minmax(0,1.2fr)] gap-3 py-2 text-sm"
                >
                  <dt className="text-muted">{label}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {emptySections.map(([title, items, empty]) => (
          <Card key={title}>
            <h2 className="text-lg font-semibold">{title}</h2>
            {items.length ? (
              items.map((item) => (
                <p key={item} className="mt-3 text-sm">
                  {item}
                </p>
              ))
            ) : (
              <p className="mt-4 rounded-control bg-canvas p-4 text-center text-sm text-muted">
                {empty}
              </p>
            )}
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="text-lg font-semibold">Application History</h2>
        <ol className="mt-4 space-y-4 border-l border-border pl-5">
          {app.history.map((event) => (
            <li key={`${event.at}-${event.title}`}>
              <b>{event.title}</b>
              <p className="text-sm text-muted">{event.detail}</p>
              <time dateTime={event.at} className="text-xs text-muted">
                {dateText(event.at)}
              </time>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Internal Notes</h2>
        <p className="my-3 text-xs text-muted">
          Notes are only visible to Firmivra administrators.
        </p>
        {app.notes.map((item) => (
          <p key={item.id} className="mb-2 rounded-control bg-canvas p-3 text-sm">
            {item.text}
          </p>
        ))}
        <form onSubmit={saveNote}>
          <textarea
            aria-label="Add an internal note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full rounded-control border border-border p-3 text-sm"
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="mt-3" disabled={!note.trim() || busy}>
            {busy ? 'Saving…' : 'Save note'}
          </Button>
        </form>
      </Card>
      {action && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-brand-900/60 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-title"
            className="w-full max-w-lg rounded-card bg-surface p-6"
          >
            <h2 id="decision-title" className="text-xl font-semibold">
              {action === 'Approve'
                ? 'Approve application?'
                : action === 'Decline'
                  ? 'Decline application?'
                  : 'Request information'}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {action === 'Approve'
                ? 'This will mark the application as approved.'
                : action === 'Decline'
                  ? 'Provide a reason to record with this application.'
                  : 'Write the message for the applicant.'}
            </p>
            <form onSubmit={runAction} className="mt-5">
              {action !== 'Approve' && (
                <label className="block text-sm font-medium">
                  {action === 'Decline' ? 'Reason' : 'Message'}
                  <textarea
                    autoFocus
                    required
                    name="detail"
                    rows={4}
                    maxLength={1000}
                    className="mt-1 w-full rounded-control border border-border p-3 font-normal"
                  />
                </label>
              )}
              {error && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {error}
                </p>
              )}
              <div className="mt-4 flex justify-end gap-3">
                <Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy
                    ? 'Submitting…'
                    : action === 'Approve'
                      ? 'Confirm approval'
                      : action === 'Decline'
                        ? 'Confirm decline'
                        : 'Send request'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
