const params = new URLSearchParams(window.location.search);

/**
 * Kiosk URL parameter, else the build value (`.env.<mode>`), else the default.
 * Empty counts as unset, so a blank Docker build arg does not blank a URL.
 */
const pick = (param: string, built: string | undefined, fallback: string) =>
  params.get(param) || built || fallback;

export const config = {
  /** `?mode=s2s` on the kiosk URL switches to real payments; demo is the safe default. */
  paymentMode: pick('mode', import.meta.env.VITE_PAYMENT_MODE, 'demo') as 'demo' | 's2s',
  /** Payments service (HTTP); `?api=` on the kiosk URL overrides the build value. */
  apiUrl: pick('api', import.meta.env.VITE_API_URL, 'http://localhost:8787/api'),
  /** Machine channel (dispense order and result); `?ws=` overrides the build value. */
  wsUrl: pick('ws', import.meta.env.VITE_WS_URL, 'ws://localhost:8787'),
  /** How often the payment status is polled while the visitor pays. */
  pollMs: 1_000,
  /** Version A shows the machine at 1:1 on 86″, version B at 76 % on 65″. */
  machineScale: Number(pick('scale', import.meta.env.VITE_MACHINE_SCALE, '1')),
  /** Back to the attract screen after this long without a touch. */
  idleResetMs: 45_000,
};
