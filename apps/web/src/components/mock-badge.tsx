import { MOCK_MODULES } from '../lib/mock';

/** Shown on every page while mock mode is on, so nobody mistakes mock data for real data. */
export function MockBadge() {
  if (MOCK_MODULES.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="mock-badge"
      className="fixed right-4 bottom-4 z-50 rounded-control bg-danger px-3 py-1 text-xs font-semibold text-white shadow-card"
    >
      Mock data: {MOCK_MODULES.join(', ')}
    </div>
  );
}
