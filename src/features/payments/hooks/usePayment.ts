import { useSyncExternalStore } from 'react';
import { demoGateway } from '../api/gateway';
import { getPaymentState, paymentActions, subscribe } from '../store/paymentStore';

export function usePayment() {
  const state = useSyncExternalStore(subscribe, getPaymentState);
  return { state, canSimulateTap: demoGateway !== null, ...paymentActions };
}
