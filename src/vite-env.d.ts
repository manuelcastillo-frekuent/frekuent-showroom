/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAYMENT_MODE?: 'demo' | 's2s';
  readonly VITE_AUTH_URL?: string;
  readonly VITE_PAYMENTS_URL?: string;
  readonly VITE_DEVICE_SERIAL?: string;
  readonly VITE_HTTP_VIA?: 'auto' | 'native' | 'fetch';
  readonly VITE_POLL_MS?: string;
  readonly VITE_MACHINE_SCALE?: string;
}

/** Set by vite.config.ts: dev-server client credentials, always null in a build. */
declare const __DEV_CLIENT_CREDENTIALS__: { clientCode: string; clientSecret: string } | null;
