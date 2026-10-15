import type { Metadata } from 'next';
import { DepartmentsScreen } from './_components/departments-screen';

export const metadata: Metadata = { title: 'Teams & departments' };

export default function TeamDepartmentsPage() {
  return <DepartmentsScreen />;
}
