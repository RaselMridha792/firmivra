const paths = {
  firm: 'M4 21V5l9-3v19M13 8h7v13M2 21h20M7 7v1m3-2v1M7 11v1m3-2v1M7 15v1m3-2v1M16 11h1m-1 4h1M8 21v-3h2',
  users:
    'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m20 0v-3a4 4 0 0 0-3-3.87M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8 0a4 4 0 0 1 0 8',
  // Three closed, rounded bars (short, medium, tall), as in the mockup.
  chart:
    'M5 13h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Zm6-4h2a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Zm6-5h2a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
  // The 8-tooth gear with a round hub (lucide "settings").
  settings:
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 9 3 3 5-6',
};
export function AuthIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
