import type { Metadata } from 'next';
import { ConvertLeadStepOne } from '../_components/convert-lead-step-one';

export const metadata: Metadata = { title: 'Convert lead: Client details & services' };

export default function LeadsIdConvertDetailsPage() {
  return <ConvertLeadStepOne activeStep="details" />;
}
