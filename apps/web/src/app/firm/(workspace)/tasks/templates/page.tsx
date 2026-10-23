import { redirect } from 'next/navigation';

/** /tasks/templates: the library is the Tasks page's Task Templates view. */
export default function TaskTemplatesPage() {
  redirect('/tasks?view=templates');
}
