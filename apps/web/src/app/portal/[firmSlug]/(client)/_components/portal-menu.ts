import { isActive, publicPath } from '../../../../../components/app-shell/types';

/** How a menu line looks on the current page: lit (the page's own line), softly lit, or plain. */
export type MenuState = 'active' | 'related' | undefined;

/**
 * "My Client Portal" pages that light Home (docs/mockups/client-portal): the Intake Form,
 * Business Documents & Resources, My Uploaded Documents and Tax Returns tabs (Intake form tab.png,
 * Business Tab.png, My docs tab.png, Taxes tab.png), and the business resource pages under
 * /resources (Business Startup Guide, External links, Tax Deductions, Record Keeping, Payroll).
 */
const HOME_PAGES = ['intake', 'business', 'documents', 'taxes', 'resources'];

/**
 * The menu line lit on each portal page, as the designs draw it (R61, Oct 19):
 * - Home on the "My Client Portal" pages above, so My Documents and Intake Forms open their tab
 *   while Home stays lit;
 * - on the Receipts & Invoices tab (invoices tab.png) Home is lit and Invoices & Payments softly;
 * - Messages on the Messages and Notes tab (Messages and notes.png), not Home;
 * - every other page lights its own line: My Profile (My profile.png), and, with no design,
 *   Appointments, an invoice's detail page (Invoices & Payments), My Services, Signatures and
 *   Tax Calculators. The notification center has no menu line and lights none.
 */
export function menuState(pathname: string, slug: string, href: string): MenuState {
  const page = (name: string) => `/${slug}/${name}`;
  const invoicesTab = publicPath(pathname) === page('invoices');
  const homePage = invoicesTab || HOME_PAGES.some((name) => isActive(pathname, page(name)));
  if (href === page('home')) return homePage ? 'active' : undefined;
  if (homePage) return invoicesTab && href === page('invoices') ? 'related' : undefined;
  return isActive(pathname, href) ? 'active' : undefined;
}
