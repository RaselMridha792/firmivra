import { useEffect } from 'react';

/**
 * Reports a step's load error to the signer page, which leaves the step when the error means it
 * can't go on (the link closed, or the signer is on another step now).
 */
export function useLost(error: unknown, onLost: (error: unknown) => void) {
  useEffect(() => {
    if (error) onLost(error);
  }, [error, onLost]);
}
