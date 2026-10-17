import type { Metadata } from 'next';
import { ConvertLeadStepOne } from './_components/convert-lead-step-one';

export const metadata: Metadata = { title: 'Convert lead: Review lead information' };

export default function LeadsIdConvertPage() {
  return <ConvertLeadStepOne />;
}
