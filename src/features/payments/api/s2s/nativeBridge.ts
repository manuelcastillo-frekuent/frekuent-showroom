/**
 * Calls into the Android shell (MainActivity's `ShowroomNative` JavaScript
 * interface). Native calls cannot return a promise, so each one carries an id
 * and the shell answers later through `window.__showroomNative.settle`.
 *
 * Only the APK has it: a browser (or `pnpm dev`) sees `isNativeAvailable()` false.
 */

interface NativeInterface {
  call(id: string, method: string, argsJson: string): void;
}

interface Settler {
  settle(id: string, ok: boolean, payloadJson: string): void;
}

declare global {
  interface Window {
    ShowroomNative?: NativeInterface;
    __showroomNative?: Settler;
  }
}

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let seq = 0;

function settler(): Settler {
  return {
    settle(id, ok, payloadJson) {
      const call = pending.get(id);
      if (!call) return;
      pending.delete(id);
      let payload: unknown;
      try {
        payload = JSON.parse(payloadJson);
      } catch {
        payload = payloadJson;
      }
      if (ok) call.resolve(payload);
      else call.reject(new Error(typeof payload === 'string' ? payload : JSON.stringify(payload)));
    },
  };
}

export const isNativeAvailable = () =>
  typeof window !== 'undefined' && typeof window.ShowroomNative?.call === 'function';

/** Runs `method` in the shell; rejects after `timeoutMs` so a lost answer never hangs a sale. */
export function callNative<T>(method: string, args: unknown, timeoutMs = 20_000): Promise<T> {
  if (!isNativeAvailable()) return Promise.reject(new Error('Native bridge not available'));
  window.__showroomNative ??= settler();
  const id = `n${++seq}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Native ${method} timed out`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v as T);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    window.ShowroomNative!.call(id, method, JSON.stringify(args ?? {}));
  });
}
