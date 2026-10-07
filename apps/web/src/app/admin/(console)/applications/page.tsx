import type { Metadata } from 'next';
import { ApplicationList } from './_components/application-list';

export const metadata: Metadata = { title: 'Firm Applications' };

export default function Applications() {
  return <ApplicationList />;
}
