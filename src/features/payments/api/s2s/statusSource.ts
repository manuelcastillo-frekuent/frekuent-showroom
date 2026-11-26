import type { PaymentsApi } from './paymentsApi';
import type { PaymentStatus } from './protocol';

/**
 * Where status changes come from. Polling today (decided for the showroom: no
 * callback, MQTT or WebSocket); kept behind this interface in case the channel
 * ever changes.
 */
export interface PaymentStatusSource {
  /**
   * Resolves with the first status in `until`, or null after `maxMs`. `onStatus`
   * sees every status read on the way. Aborting the signal stops it (null).
   */
  waitFor(
    uuid: string,
    until: readonly PaymentStatus[],
    options: { maxMs: number; signal?: AbortSignal; onStatus?: (s: PaymentStatus) => void },
  ): Promise<PaymentStatus | null>;
}

export interface PollingOptions {
  /** Interval during the first minute of a wait. */
  pollMs: number;
  /** Interval after that minute (at least `pollMs`). */
  slowPollMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * `GET /{uuid}/status` every `pollMs`, slower after the first minute. A network
 * error or 5xx in one round never ends the wait: the next round tries again.
 * One request at a time: the next waits for the previous answer.
 */
export function pollingStatusSource(
  api: PaymentsApi,
  options: PollingOptions,
): PaymentStatusSource {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const slow = Math.max(options.pollMs, options.slowPollMs ?? 2_000);
  return {
    async waitFor(uuid, until, { maxMs, signal, onStatus }) {
      const start = now();
      while (!signal?.aborted) {
        try {
          const { status } = await api.status(uuid);
          if (signal?.aborted) return null;
          onStatus?.(status);
          if (until.includes(status)) return status;
        } catch (error) {
          console.warn('[showroom] status poll failed', error);
        }
        const elapsed = now() - start;
        if (elapsed >= maxMs) return null;
        await sleep(elapsed < 60_000 ? options.pollMs : slow, signal);
      }
      return null;
    },
  };
}
