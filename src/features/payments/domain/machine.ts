import type { PaymentEvent, PaymentRequest } from './types';

export type FailReason = Extract<PaymentEvent, { type: 'failed' }>['reason'];

interface Approved {
  request: PaymentRequest;
  paymentId: string;
  authCode?: string;
  method?: 'card' | 'wallet';
}

export type PaymentState =
  | { status: 'idle' }
  | { status: 'requesting'; request: PaymentRequest }
  | { status: 'waiting_tap'; request: PaymentRequest; paymentId: string }
  | { status: 'authorising'; request: PaymentRequest; paymentId: string }
  /** `undelivered`: the delivery failed; the backend refunds once told so. */
  | ({ status: 'dispensing' | 'delivered' | 'undelivered' } & Approved)
  | { status: 'failed'; request: PaymentRequest; paymentId?: string; reason: FailReason };

export type PaymentAction =
  | { type: 'REQUEST'; request: PaymentRequest }
  | { type: 'STARTED'; paymentId: string }
  | { type: 'EVENT'; event: PaymentEvent }
  | { type: 'START_FAILED' }
  | { type: 'DISPENSE_DONE'; success: boolean }
  | { type: 'RESET' };

export const initialPaymentState: PaymentState = { status: 'idle' };

/**
 * Pure transition function. Anything that does not fit the current state is
 * ignored, so a late or duplicated backend event (same uuid sent twice, an
 * event after the visitor cancelled) can never move the screen backwards.
 */
export function paymentReducer(state: PaymentState, action: PaymentAction): PaymentState {
  if (action.type === 'RESET') return initialPaymentState;

  switch (state.status) {
    case 'idle':
      return action.type === 'REQUEST' ? { status: 'requesting', request: action.request } : state;

    case 'requesting':
      if (action.type === 'STARTED')
        return { status: 'waiting_tap', request: state.request, paymentId: action.paymentId };
      if (action.type === 'START_FAILED')
        return { status: 'failed', request: state.request, reason: 'offline' };
      return state;

    case 'waiting_tap':
    case 'authorising': {
      if (action.type !== 'EVENT' || action.event.paymentId !== state.paymentId) return state;
      const event = action.event;
      if (event.type === 'authorising') return { ...state, status: 'authorising' };
      // Approval and the order to dispense arrive together.
      if (event.type === 'dispense')
        return {
          status: 'dispensing',
          request: state.request,
          paymentId: state.paymentId,
          authCode: event.authCode,
          method: event.method,
        };
      if (event.type === 'failed')
        return {
          status: 'failed',
          request: state.request,
          paymentId: state.paymentId,
          reason: event.reason,
        };
      return state;
    }

    case 'dispensing':
      if (action.type !== 'DISPENSE_DONE') return state;
      return { ...state, status: action.success ? 'delivered' : 'undelivered' };

    case 'delivered':
    case 'undelivered':
    case 'failed':
      return state;
  }
}

/** A visitor's sale is still moving; the screen must not reset under it. */
export const isBusy = (state: PaymentState) =>
  state.status !== 'idle' &&
  state.status !== 'delivered' &&
  state.status !== 'undelivered' &&
  state.status !== 'failed';
