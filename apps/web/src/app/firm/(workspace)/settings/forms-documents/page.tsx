import type { Metadata } from 'next';
import { FormsDocumentsScreen } from './_components/forms-documents-screen';

export const metadata: Metadata = { title: 'Forms & documents' };

export default function SettingsFormsDocumentsPage() {
  return <FormsDocumentsScreen />;
}
