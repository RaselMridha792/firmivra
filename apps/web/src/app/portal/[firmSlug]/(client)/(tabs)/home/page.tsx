import type { Metadata } from 'next';
import { IntakeCards } from '../intake/_components/intake-cards';

export const metadata: Metadata = { title: 'Home' };

/**
 * Home (Octavia's Client Portal review, Nov 18): its own address, the My Client Portal view with
 * its first tab, Intake Form, open. While the address is /home, only Home is lit in the menu.
 */
export default function PortalHomePage() {
  return <IntakeCards />;
}
