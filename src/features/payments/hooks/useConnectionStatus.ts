import { useSyncExternalStore } from 'react';
import { connection } from '../api/gateway';
import type { ConnectionStatus } from '../api/s2s/wsGateway';

const noop = () => () => undefined;
const none = () => null;

/** State of the link to the showroom server, or null in demo mode. */
export function useConnectionStatus(): ConnectionStatus | null {
  return useSyncExternalStore(connection?.subscribeStatus ?? noop, connection?.getStatus ?? none);
}
