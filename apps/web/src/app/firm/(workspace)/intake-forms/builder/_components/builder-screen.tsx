'use client';

import { BuilderFrame } from './builder-frame';
import { SectionsEditor } from './sections-editor';

/** /intake-forms/builder/[formId]: the builder with the Form Builder tab open. */
export function BuilderScreen({ formId }: { formId: string }) {
  return (
    <BuilderFrame formId={formId} tab="builder">
      {(state) => <SectionsEditor state={state} />}
    </BuilderFrame>
  );
}
