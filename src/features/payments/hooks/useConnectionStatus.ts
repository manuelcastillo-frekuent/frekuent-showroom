import { useSyncExternalStore } from 'react';
import { connection } from '../api/gateway';
import type { ConnectionStatus } from '../api/s2s/machineChannel';

const noop = () => () => undefined;
const none = () => null;

/** State of the machine channel, or null in demo mode. */
export function useConnectionStatus(): ConnectionStatus | null {
  return useSyncExternalStore(connection?.subscribeStatus ?? noop, connection?.getStatus ?? none);
}
