'use client';

import { Lightning, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { CardFrame, outlineButton } from './profile-cards';
import { ActivityTimeline, LogActivityForm } from './profile-activity';

/** Activity tab: the whole history (Recent Activity, in full) and Log Activity. */
export function ActivityTab() {
  const [logging, setLogging] = useState(false);
  return (
    <CardFrame
      icon={Lightning}
      title="Recent Activity"
      testId="card-activity"
      action={
        <button type="button" onClick={() => setLogging(!logging)} className={outlineButton}>
          <Plus aria-hidden weight="bold" className="size-4" /> Log Activity
        </button>
      }
    >
      {logging ? <LogActivityForm onDone={() => setLogging(false)} /> : null}
      <ActivityTimeline
        kind="all"
        label="Lead activity"
        emptyText="No activity yet. Everything done for this lead appears here."
      />
    </CardFrame>
  );
}
