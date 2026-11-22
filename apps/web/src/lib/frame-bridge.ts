/**
 * The booking page inside a frame on a firm's own website (Appointments D3). Browsers keep the
 * portal's sign-in cookies out of another site's frame, so nothing that signs in or moves on may
 * happen in the frame: every link opens in a new tab. The page also tells its parent how tall it
 * is, so the embed code's script can size the frame. Outside a frame none of this runs.
 */
export const HEIGHT_MESSAGE = 'firmivra:height';

/** A link that leaves the frame: a web address or a path, not an in-page anchor, mail or phone. */
export function opensInNewTab(href: string | null | undefined): boolean {
  if (!href || href.startsWith('#')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return /^https?:/i.test(href);
  return true;
}

export function inFrame(win: Window): boolean {
  try {
    return win.parent !== win;
  } catch {
    return true;
  }
}

/** The height message: the number and nothing else. */
export const heightMessage = (height: number) => ({ type: HEIGHT_MESSAGE, height });

/**
 * Starts the bridge on `win` if it is framed; returns what undoes it. Links: a capture-phase click
 * handler marks the clicked link `target="_blank" rel="noopener"` before the browser or Next.js
 * follows it, so every link on the page is covered, whenever it was rendered. Height: the page's
 * own height (the full-screen minimums are lifted while framed, or the frame could never shrink),
 * posted to the parent with target origin `*` (the number is all it carries), at most every 100 ms.
 */
export function startFrameBridge(win: Window, doc: Document): () => void {
  if (!inFrame(win)) return () => {};
  doc.documentElement.setAttribute('data-framed', '');
  const style = doc.createElement('style');
  style.textContent = 'html[data-framed] .min-h-screen{min-height:0}';
  doc.head.appendChild(style);

  const onClick = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (link && opensInNewTab(link.getAttribute('href'))) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener');
    }
  };
  doc.addEventListener('click', onClick, true);

  let last = -1;
  let timer: number | undefined;
  const post = () => {
    timer = undefined;
    const height = Math.ceil(doc.body.getBoundingClientRect().height);
    if (height === last || height <= 0) return;
    last = height;
    win.parent.postMessage(heightMessage(height), '*');
  };
  const schedule = () => {
    if (timer === undefined) timer = win.setTimeout(post, 100);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(doc.body);
  post();

  return () => {
    doc.removeEventListener('click', onClick, true);
    observer.disconnect();
    if (timer !== undefined) win.clearTimeout(timer);
    style.remove();
    doc.documentElement.removeAttribute('data-framed');
  };
}
