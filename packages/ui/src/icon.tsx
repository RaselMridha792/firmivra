import type { SVGProps } from 'react';

const paths = {
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  file: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h8',
  firm: 'M4 21V5l9-3v19M13 8h7v13M2 21h20M7 7v1m3-2v1M7 11v1m3-2v1M7 15v1m3-2v1M16 11h1m-1 4h1M8 21v-3h2',
  users:
    'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m20 0v-3a4 4 0 0 0-3-3.87M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8 0a4 4 0 0 1 0 8',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
  chart: 'M3 21V13h4v8M10 21V8h4v13M17 21V3h4v18',
  sales: 'M3 17 9 11l4 4 8-11M15 4h6v6M3 21v-4M9 21v-6M15 21v-5M21 21v-8',
  card: 'M3 4h18v16H3V4ZM3 9h18M6 16h4',
  wallet: 'M3 5h17v4M3 5v15h18V9H3m13 4h5v4h-5v-4Z',
  headset: 'M3 15v-3a9 9 0 0 1 18 0v3M3 13H1v7h5v-7H3Zm18 0h2v7h-5v-7h3M18 21a4 4 0 0 1-4 2h-2',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 10h18c0-3-3-3-3-10M10 21h4',
  shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 9 3 3 5-6',
  settings:
    'm9 3-1 3-3 1-2 3 2 2-1 3 3 2 2-1 3 2 3-2 2 1 3-2-1-3 2-2-2-3-3-1-1-3H9Zm3 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  search: 'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm5 12 6 6',
  calendar: 'M4 5h16v16H4V5ZM7 2v6m10-6v6M4 10h16M7 13h2m3 0h2m3 0h1M7 17h2m3 0h2',
  mail: 'M2 4h20v16H2V4Zm0 1 10 8L22 5',
  lock: 'M5 10h14v12H5V10Zm3 0V6a4 4 0 0 1 8 0v4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  back: 'M20 12H4m6-6-6 6 6 6',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  checkCircle: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-5 10 3 3 7-7',
  x: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 4v16M4 12h16',
  clock: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 4v6l4 3',
  message: 'M3 3h18v15H8l-5 4V3Zm4 5h10M7 12h6',
  folder: 'M2 5h7l2 3h11v13H2V5Zm0 3h9',
  database:
    'M21 5c0 2-4 3-9 3S3 7 3 5s4-3 9-3 9 1 9 3ZM3 5v14c0 2 4 3 9 3s9-1 9-3V5M3 12c0 2 4 3 9 3s9-1 9-3',
  history: 'M3 8a9 9 0 1 1 0 8M3 3v5h5M12 7v5l4 2',
  edit: 'm16 3 5 5L9 20l-6 1 1-6L16 3Zm-2 2 5 5',
  external: 'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
  power: 'M12 2v10M6 5a9 9 0 1 0 12 0',
  logout: 'M9 3H3v18h6M9 12h13m-5-5 5 5-5 5',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  bolt: 'm14 2-9 12h6l-1 8 9-12h-6l1-8Z',
  warning: 'm12 2 10 19H2L12 2Zm0 7v5m0 3v1',
  menu: 'M3 5h18M3 12h18M3 19h18',
  filter: 'M3 3h18l-7 8v9l-4-2v-7L3 3Z',
  upload: 'M8 15 12 11l4 4M12 11v10M7 18H5a4 4 0 0 1 0-8 7 7 0 0 1 14-1 4 4 0 0 1 0 9h-2',
  download: 'M12 3v13m-5-5 5 5 5-5M3 16v5h18v-5',
  info: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 8v7m0-11v1',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
