const params = new URLSearchParams(window.location.search);

export const config = {
  /** `?mode=s2s` on the kiosk URL switches to real payments; demo is the safe default. */
  paymentMode: (params.get('mode') ?? import.meta.env.VITE_PAYMENT_MODE ?? 'demo') as
    'demo' | 's2s',
  /** Showroom server WebSocket; `?ws=` on the kiosk URL overrides the build value. */
  wsUrl: params.get('ws') ?? import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787',
  /** Version A shows the machine at 1:1 on 86″, version B at 76 % on 65″. */
  machineScale: Number(params.get('scale') ?? import.meta.env.VITE_MACHINE_SCALE ?? 1),
  /** Back to the attract screen after this long without a touch. */
  idleResetMs: 45_000,
};
