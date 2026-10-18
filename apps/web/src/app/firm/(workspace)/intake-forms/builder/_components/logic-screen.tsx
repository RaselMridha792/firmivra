'use client';

import { BuilderFrame } from './builder-frame';
import { LogicRules } from './logic-rules';

/** /intake-forms/builder/[formId]/logic: the builder with the Logic & Rules tab open. */
export function LogicScreen({ formId }: { formId: string }) {
  return (
    <BuilderFrame formId={formId} tab="logic">
      {(state) => <LogicRules state={state} />}
    </BuilderFrame>
  );
}
