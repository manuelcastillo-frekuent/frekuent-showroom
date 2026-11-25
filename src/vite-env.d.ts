/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAYMENT_MODE?: 'demo' | 's2s';
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_MACHINE_SCALE?: string;
}
