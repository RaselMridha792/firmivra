'use client';

import { BuilderFrame } from './builder-frame';
import { FormPreview } from './form-preview';

/** /intake-forms/builder/[formId]/preview: the builder with the Preview tab open. */
export function PreviewScreen({ formId }: { formId: string }) {
  return (
    <BuilderFrame formId={formId} tab="preview">
      {(state) => <FormPreview state={state} />}
    </BuilderFrame>
  );
}
