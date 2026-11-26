import { demoGateway, gateway } from '../api/gateway';
import {
  initialPaymentState,
  isBusy,
  paymentReducer,
  type PaymentAction,
  type PaymentState,
} from '../domain/machine';
import type { PaymentRequest } from '../domain/types';

/** The one payment in flight, shared by every scenario. */
let state: PaymentState = initialPaymentState;
const subscribers = new Set<() => void>();

function dispatch(action: PaymentAction) {
  const next = paymentReducer(state, action);
  if (next === state) return;
  state = next;
  subscribers.forEach((notify) => notify());
}

export const getPaymentState = () => state;

export function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

export const paymentActions = {
  async pay(request: PaymentRequest) {
    if (isBusy(state)) return;
    dispatch({ type: 'REQUEST', request });
    try {
      const paymentId = await gateway.start(request, (event) => dispatch({ type: 'EVENT', event }));
      dispatch({ type: 'STARTED', paymentId });
    } catch {
      dispatch({ type: 'START_FAILED' });
    }
  },

  async cancel() {
    if (state.status === 'waiting_tap') await gateway.cancel(state.paymentId);
    else if (state.status === 'requesting') dispatch({ type: 'RESET' });
  },

  /** Demo mode only: what tapping the physical Spot would do. No-op in s2s. */
  simulateTap() {
    if (state.status === 'waiting_tap') demoGateway.simulateTap(state.paymentId);
  },

  async finishDispense(success = true) {
    if (state.status !== 'dispensing') return;
    const { paymentId } = state;
    dispatch({ type: 'DISPENSE_DONE', success });
    await gateway.confirmDispense(paymentId, success).catch(() => undefined);
  },

  reset: () => dispatch({ type: 'RESET' }),
};
