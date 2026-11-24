import { useConnectionStatus } from '@/features/payments';

/**
 * Discreet corner mark for staff when the server link is not up; sales fail
 * as offline meanwhile. Hidden while connected and in demo mode.
 */
export function ConnectionBadge() {
  const status = useConnectionStatus();
  if (status === null || status === 'open') return null;
  return (
    <span
      className="abs"
      role="status"
      style={{ right: 40, bottom: 32, fontSize: 28, color: 'rgba(118,118,118,.6)' }}
    >
      {status === 'connecting' ? 'connecting…' : 'offline'}
    </span>
  );
}
