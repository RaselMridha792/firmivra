'use client';

import { QRCodeSVG } from 'qrcode.react';

/**
 * A QR code as SVG, for example the authenticator setup link in MFA setup (F02):
 *   <QrCode value={setup.otpauthUri} label="Scan with your authenticator app" />
 * Show the secret as text next to it too, for people who can't scan.
 */
export function QrCode({
  value,
  label = 'QR code',
  size = 192,
}: {
  value: string;
  /** Read by screen readers. */
  label?: string;
  size?: number;
}) {
  return <QRCodeSVG value={value} size={size} level="M" marginSize={2} title={label} role="img" />;
}
