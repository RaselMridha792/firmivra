'use client';

import { type MemberAvailability, SetMeetingLinkRequest } from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { CALENDAR, CALENDAR_ERRORS } from '../../../calendar/_components/shared';

/**
 * Advisory B11 (Octavia, Oct 25): a member's default video meeting link, which Generate Zoom Link
 * puts on their appointments. Owner and Admin set anyone's, Staff their own (the API checks
 * again). A link can carry the meeting's passcode, so only those who may change it see it.
 */
export function MeetingLink({
  member,
  editable,
}: {
  member: MemberAvailability;
  editable: boolean;
}) {
  const [url, setUrl] = useState(member.meetingUrl ?? '');
  const [problem, setProblem] = useState('');
  const save = useApiMutation(
    (body: SetMeetingLinkRequest) => api.availability.setMeetingLink(member.member.userId, body),
    { invalidate: CALENDAR },
  );
  const submit = (meetingUrl: string | null) => {
    const checked = SetMeetingLinkRequest.safeParse({ meetingUrl });
    setProblem(checked.success ? '' : (checked.error.issues[0]?.message ?? 'Check the link.'));
    if (checked.success) save.mutate({ meetingUrl });
  };
  const saved = save.data ? save.data.meetingUrl : member.meetingUrl;

  return (
    <Card title="Video meeting link" data-testid="meeting-link">
      <p className="mb-3 text-sm text-muted">
        Generate Zoom Link adds this link to {member.member.name}&rsquo;s video appointments.
      </p>
      {editable ? (
        <div className="flex flex-col items-start gap-2">
          <div className="w-full max-w-xl">
            <Input
              label="Meeting link"
              type="url"
              placeholder="https://"
              value={url}
              onChange={(event) => {
                save.reset();
                setUrl(event.target.value);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => submit(url)} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save meeting link'}
            </Button>
            {saved ? (
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setUrl('');
                  submit(null);
                }}
              >
                Remove link
              </Button>
            ) : null}
          </div>
          {save.isSuccess && !problem ? (
            <p role="status" className="text-sm text-success">
              {save.data.meetingUrl ? 'Meeting link saved.' : 'Meeting link removed.'}
            </p>
          ) : null}
          {problem || save.error ? (
            <p role="alert" className="text-sm text-danger">
              {problem || errorMessage(save.error, CALENDAR_ERRORS)}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text">
          {saved ? 'A meeting link is set.' : 'No meeting link yet.'} {member.member.name} or an
          Owner or Admin sets it.
        </p>
      )}
    </Card>
  );
}
