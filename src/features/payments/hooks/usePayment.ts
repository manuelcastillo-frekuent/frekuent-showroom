import { useSyncExternalStore } from 'react';
import { paymentMode } from '../api/gateway';
import { getPaymentState, paymentActions, subscribe } from '../store/paymentStore';

export function usePayment() {
  const state = useSyncExternalStore(subscribe, getPaymentState);
  const mode = usePaymentMode();
  return { state, canSimulateTap: mode === 'demo', ...paymentActions };
}

/** `demo` (simulated charges) or `s2s` (real Spot); can switch to demo mid-session. */
export function usePaymentMode() {
  return useSyncExternalStore(paymentMode.subscribe, paymentMode.get);
}
