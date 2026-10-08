const paths = {
  firm: 'M4 21V5l9-3v19M13 8h7v13M2 21h20M7 7v1m3-2v1M7 11v1m3-2v1M7 15v1m3-2v1M16 11h1m-1 4h1M8 21v-3h2',
  users:
    'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m20 0v-3a4 4 0 0 0-3-3.87M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8 0a4 4 0 0 1 0 8',
  chart: 'M3 21V13h4v8M10 21V8h4v13M17 21V3h4v18',
  settings:
    'm9 3-1 3-3 1-2 3 2 2-1 3 3 2 2-1 3 2 3-2 2 1 3-2-1-3 2-2-2-3-3-1-1-3H9Zm3 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
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
