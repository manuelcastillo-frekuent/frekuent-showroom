const params = new URLSearchParams(window.location.search);

/**
 * Kiosk URL parameter, else the build value (`.env.<mode>` or Vercel), else the
 * default. Empty counts as unset, so a blank Docker build arg does not blank a URL.
 */
const pick = (param: string | null, built: string | undefined, fallback: string) =>
  (param && params.get(param)) || built || fallback;

export const config = {
  /** `?mode=s2s` on the kiosk URL switches to real payments; demo is the safe default. */
  paymentMode: pick('mode', import.meta.env.VITE_PAYMENT_MODE, 'demo') as 'demo' | 's2s',
  /** auth-service: client token and refresh (only used by the page in local development). */
  authUrl: pick(null, import.meta.env.VITE_AUTH_URL, 'http://localhost:8787/auth'),
  /** Payments API, external clients. */
  paymentsUrl: pick(
    null,
    import.meta.env.VITE_PAYMENTS_URL,
    'http://localhost:8787/payments/v1/external',
  ),
  /** Serial number of the Spot Pro on the wall (an integer). */
  deviceSerial: Number(pick(null, import.meta.env.VITE_DEVICE_SERIAL, '105640')),
  /**
   * How the screen reaches the API: `native` through the APK (no CORS there),
   * `fetch` from the page, or `auto` (native inside the APK, fetch elsewhere).
   */
  httpVia: pick(null, import.meta.env.VITE_HTTP_VIA, 'auto') as 'auto' | 'native' | 'fetch',
  /** Status polling while a charge is open; slower after its first minute. */
  pollMs: Number(pick(null, import.meta.env.VITE_POLL_MS, '2000')),
  /** Version A shows the machine at 1:1 on 86″, version B at 76 % on 65″. */
  machineScale: Number(pick('scale', import.meta.env.VITE_MACHINE_SCALE, '1')),
  /** Back to the attract screen after this long without a touch. */
  idleResetMs: 45_000,
};

/**
 * Client credentials for the page itself, only under the dev server (`pnpm dev:*`),
 * from SHOWROOM_DEV_CLIENT_CODE / SHOWROOM_DEV_CLIENT_SECRET in a `.env.*.local`.
 * vite.config.ts defines them as null for any build, so a deployed bundle never
 * carries the secret. Deployed, the APK holds the credentials and hands out tokens.
 */
export const devClientCredentials = __DEV_CLIENT_CREDENTIALS__;
