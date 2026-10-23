import type { ReactNode } from 'react';
import { ConvertDraftProvider } from './_components/convert-draft';

/** Convert to Client's steps share one draft, so what is typed on a step is what is sent. */
export default function LeadsIdConvertLayout({ children }: { children: ReactNode }) {
  return <ConvertDraftProvider>{children}</ConvertDraftProvider>;
}
