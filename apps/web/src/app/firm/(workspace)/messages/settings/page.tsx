import type { Metadata } from 'next';
import { MessageSettingsScreen } from './_components/message-settings-screen';

export const metadata: Metadata = { title: 'Messages Settings' };

/** /messages/settings (MSG-F02): the Messages header's Settings, with Back to Messages. */
export default function MessageSettingsPage() {
  return <MessageSettingsScreen />;
}
