import type { Metadata } from 'next';
import { InPersonResume } from '../../../../../components/esign/in-person';

export const metadata: Metadata = { title: 'In-person signing' };

export default function InPersonResumePage() {
  return <InPersonResume />;
}
