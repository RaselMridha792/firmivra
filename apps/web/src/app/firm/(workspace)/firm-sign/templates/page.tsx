import type { Metadata } from 'next';
import { TemplatesList } from './_components/templates-list';

export const metadata: Metadata = { title: 'Signing templates' };

export default function SigningTemplatesPage() {
  return <TemplatesList />;
}
