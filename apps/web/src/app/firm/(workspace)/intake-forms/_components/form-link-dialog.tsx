'use client';

import { ApiRequestError, type IntakeFormListItem } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { PublicLinkSection } from '../../../../../components/public-link';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';

/**
 * Whether a form is its service's main form, the only kind with a public link (Octavia's I3;
 * Rasel, Oct 22): the service's default template of one of the six Begin Online kinds. A hint
 * for showing the action; the API decides (404 for any other form).
 */
export const isMainForm = (form: Pick<IntakeFormListItem, 'isTemplate' | 'service' | 'category'>) =>
  form.isTemplate && form.service !== null && form.category !== 'OTHER';

const NOT_MAIN =
  "Only each service's main form has a public link: its Begin Online page. Send this form to a client instead.";

/**
 * Form Link, titled with the form's name: the main form's public link and embed code (its
 * service's Begin Online page), each with Copy, for a button or a frame on the firm's own
 * website. Mounted only while open; reading the link changes nothing.
 */
export function FormLinkDialog({
  formId,
  name,
  onClose,
}: {
  formId: string;
  name: string;
  onClose: () => void;
}) {
  const link = useApiQuery(['intake-forms', 'form', formId, 'public-link'], () =>
    api.intakeForms.publicLink(formId),
  );
  const notMain = link.error instanceof ApiRequestError && link.error.status === 404;
  const emptyText = link.isPending
    ? 'Loading the form link…'
    : notMain
      ? NOT_MAIN
      : link.isError
        ? `The form link could not be loaded. ${errorMessage(link.error)}`
        : undefined;
  return (
    <Modal
      open
      title={name}
      subtitle="Put this form on your website: copy its link for a button, or its embed code."
      onClose={onClose}
      footer={
        <>
          {link.isError && !notMain ? (
            <Button variant="secondary" onClick={() => void link.refetch()}>
              Try Again
            </Button>
          ) : null}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <PublicLinkSection kind="INTAKE_FORM" link={link.data} emptyText={emptyText} />
    </Modal>
  );
}
