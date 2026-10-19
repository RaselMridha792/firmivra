import type { Metadata } from 'next';
import { ConvertLeadStepOne } from '../_components/convert-lead-step-one';

export const metadata: Metadata = { title: 'Convert lead: Portal & settings' };

export default function LeadsIdConvertPortalPage() {
  return <ConvertLeadStepOne activeStep="portal" />;
}
