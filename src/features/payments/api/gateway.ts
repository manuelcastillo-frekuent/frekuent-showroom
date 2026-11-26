import { config, devClientCredentials } from '@/shared/config/env';
import type { PaymentGateway } from '../domain/types';
import { MockGateway } from './mock/mockGateway';
import {
  clientCredentialsTokenProvider,
  nativeTokenProvider,
  type TokenProvider,
} from './s2s/auth';
import { fetchTransport, nativeTransport } from './s2s/http';
import { isNativeAvailable } from './s2s/nativeBridge';
import { localChargeStore } from './s2s/openCharge';
import { createPaymentsApi } from './s2s/paymentsApi';
import { ChargeUnavailableError, S2sGateway } from './s2s/s2sGateway';
import { pollingStatusSource } from './s2s/statusSource';

/** The test environment runs behind ngrok, which wants this header or answers with a warning page. */
const tunnelHeaders = (url: string): Record<string, string> =>
  /ngrok/.test(url) ? { 'ngrok-skip-browser-warning': '1' } : {};

function createRealGateway(): S2sGateway | null {
  const native = isNativeAvailable();
  const useNative = config.httpVia === 'native' || (config.httpVia === 'auto' && native);
  let tokens: TokenProvider | null = null;
  if (native) tokens = nativeTokenProvider();
  else if (devClientCredentials)
    tokens = clientCredentialsTokenProvider({
      transport: fetchTransport(),
      authUrl: config.authUrl,
      headers: tunnelHeaders(config.authUrl),
      ...devClientCredentials,
    });
  if (!tokens) {
    console.warn('[showroom] s2s mode without credentials (no APK, no dev credentials): simulated');
    return null;
  }
  const api = createPaymentsApi({
    transport: useNative ? nativeTransport() : fetchTransport(),
    tokens,
    baseUrl: config.paymentsUrl,
    headers: tunnelHeaders(config.paymentsUrl),
  });
  const real = new S2sGateway(
    api,
    pollingStatusSource(api, { pollMs: config.pollMs }),
    localChargeStore(),
    {
      deviceSerial: config.deviceSerial,
    },
  );
  // A previous run may have left a charge open on the Spot.
  void real.recover();
  return real;
}

const mock = new MockGateway();
const real = config.paymentMode === 's2s' ? createRealGateway() : null;

/** Simulated from the start in demo mode, or once the real Spot proves unavailable. */
let simulated = real === null;
const modeListeners = new Set<() => void>();

export const paymentMode = {
  get: (): 'demo' | 's2s' => (simulated ? 'demo' : 's2s'),
  subscribe(notify: () => void) {
    modeListeners.add(notify);
    return () => {
      modeListeners.delete(notify);
    };
  },
};

const route = (paymentId: string): PaymentGateway =>
  paymentId.startsWith('mock-') || !real ? mock : real;

/**
 * Real charges while the Spot can take them; the simulated gateway otherwise.
 * A 403 configuration error or a disconnected Spot on /create switches the
 * screen to simulated mode for the rest of the session, with the "demo" mark,
 * so a fair without network keeps the demo running (brief §11).
 */
export const gateway: PaymentGateway = {
  kind: real ? 's2s' : 'mock',
  async start(request, onEvent) {
    if (!simulated && real) {
      try {
        return await real.start(request, onEvent);
      } catch (error) {
        if (!(error instanceof ChargeUnavailableError)) throw error;
        console.warn('[showroom] payments unavailable, switching to simulated mode', error);
        simulated = true;
        modeListeners.forEach((notify) => notify());
      }
    }
    return mock.start(request, onEvent);
  },
  cancel: (paymentId) => route(paymentId).cancel(paymentId),
  confirmDispense: (paymentId, success) => route(paymentId).confirmDispense(paymentId, success),
};

/** There is no physical Spot in simulated mode, so the screen fakes the tap. */
export const demoGateway = mock;
