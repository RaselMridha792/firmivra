import { redirect } from 'next/navigation';

// /settings opens Profile (docs/junior/PAGE-MAP.md).
export default function SettingsIndex() {
  redirect('/settings/profile');
}
