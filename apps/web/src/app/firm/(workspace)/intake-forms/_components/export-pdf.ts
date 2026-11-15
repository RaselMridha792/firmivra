import { ApiRequestError, type FormFileLink } from '@firmivra/types';
import { errorCode } from '../../../../../lib/errors';

/**
 * USABILITY-04: why an export failed, in words, with what to do; the page stays where it is.
 * The cause behind a browser error page is not known: the PDF opens in its own tab.
 */
export function exportFailed(error: unknown): string {
  if (error instanceof TypeError)
    return 'We couldn’t reach Firmivra to make the PDF. Check your connection, then use Export PDF again.';
  const code = errorCode(error);
  if (code === 'FILE_STORE_UNAVAILABLE')
    return 'The PDF couldn’t be saved right now. Use Export PDF again in a minute; nothing on this page changed.';
  if (error instanceof ApiRequestError && error.status === 400)
    return 'This form can’t be made into a PDF yet. Its answers are on the Responses tab.';
  return 'The PDF couldn’t be made. Use Export PDF again; if it keeps failing, contact support with this page’s address.';
}

export const POPUP_BLOCKED =
  'Your browser blocked the new tab for the PDF. Allow pop-ups for Firmivra, then use Export PDF again.';

/**
 * Opens a tab in the click (so it is not blocked), then sends it to the PDF once the link is made.
 * The page that asked stays as it is whatever happens there; `failed` gets the words to show.
 */
export function openPdf(
  make: (handlers: {
    onSuccess: (link: FormFileLink) => void;
    onError: (error: unknown) => void;
  }) => void,
  failed: (text: string) => void,
): void {
  const tab = window.open('', '_blank');
  make({
    onSuccess: (link) => {
      if (!tab) return failed(POPUP_BLOCKED);
      tab.opener = null;
      tab.location.href = link.url;
    },
    onError: (error) => {
      tab?.close();
      failed(exportFailed(error));
    },
  });
}
