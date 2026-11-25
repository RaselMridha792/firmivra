'use client';

import { useEffect } from 'react';
import { startFrameBridge } from '../../../../../../../lib/frame-bridge';

/** Inside a frame on a firm's website: posts the page height and opens every link in a new tab. */
export function FrameBridge() {
  useEffect(() => startFrameBridge(window, document), []);
  return null;
}
