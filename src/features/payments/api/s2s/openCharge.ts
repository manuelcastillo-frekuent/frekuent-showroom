/**
 * The charge in flight, kept across restarts (brief §8): if the APK dies with a
 * charge open, the next start finds it and leaves the Spot free (§10).
 */
export type ChargePhase = 'created' | 'paying' | 'dispensing' | 'reported';

export interface OpenCharge {
  uuid: string;
  phase: ChargePhase;
}

export interface ChargeStore {
  load(): OpenCharge | null;
  save(charge: OpenCharge): void;
  clear(): void;
}

const KEY = 'showroom.openCharge';

/** localStorage, which may be missing or throw (private mode, blocked storage). */
export const localChargeStore = (): ChargeStore => ({
  load() {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      return raw ? (JSON.parse(raw) as OpenCharge) : null;
    } catch {
      return null;
    }
  },
  save(charge) {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(charge));
    } catch {
      // Without storage the screen still works; it only loses restart recovery.
    }
  },
  clear() {
    try {
      globalThis.localStorage?.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
  },
});

export const memoryChargeStore = (): ChargeStore => {
  let value: OpenCharge | null = null;
  return {
    load: () => value,
    save: (c) => void (value = c),
    clear: () => void (value = null),
  };
};
