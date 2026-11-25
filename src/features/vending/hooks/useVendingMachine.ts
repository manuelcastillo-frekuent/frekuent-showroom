import { useEffect, useState } from 'react';
import { usePayment } from '@/features/payments';
import { CODE_LENGTH, type Key } from '../domain/keypad';
import { findProduct } from '../domain/products';

/** How long the result stays on screen before the machine clears itself. */
const FAILED_RESET_MS = 3500;
/** A failed delivery shows two messages in turn, each for this long, so both can be read. */
const UNDELIVERED_STEP_MS = 5000;
const UNDELIVERED_RESET_MS = 2 * UNDELIVERED_STEP_MS;
const DELIVERED_RESET_MS = 8000;

const RESET_AFTER: Partial<Record<string, number>> = {
  failed: FAILED_RESET_MS,
  undelivered: UNDELIVERED_RESET_MS,
  delivered: DELIVERED_RESET_MS,
};

/**
 * Everything the vending machine does: the typed code, keypad rules, starting
 * the payment, the delivery (or a forced failed one) and clearing up after.
 * Components only render its output.
 */
export function useVendingMachine() {
  const { state, pay, cancel, finishDispense, reset, simulateTap, canSimulateTap } = usePayment();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Staff switch: the next delivery jams and the screen reports it failed. */
  const [failNextDelivery, setFailNextDelivery] = useState(false);
  /** Payment whose failed delivery has moved on to its second message (the refund). */
  const [refundShownFor, setRefundShownFor] = useState<string | null>(null);

  const selected =
    state.status === 'idle' ? null : (findProduct(state.request.productCode) ?? null);
  /** The spiral turns, whether the product then falls or jams. */
  const dispensing = selected !== null && state.status === 'dispensing';
  /** The product sticks on its spiral, and stays stuck until the machine resets. */
  const jamming =
    (dispensing && failNextDelivery) || (selected !== null && state.status === 'undelivered');
  /** The product is flying to the tray. */
  const flying = dispensing && !failNextDelivery;
  /** The product has left its slot: in flight or waiting in the tray. */
  const dropping = flying || (selected !== null && state.status === 'delivered');
  const waitingTap = state.status === 'waiting_tap';
  const undeliveredId = state.status === 'undelivered' ? state.paymentId : null;
  const refundShown = undeliveredId !== null && refundShownFor === undeliveredId;

  const clear = () => {
    reset();
    setCode('');
    setError(null);
  };

  // Return to a clean machine after a result, or once the item has been taken.
  useEffect(() => {
    const ms = RESET_AFTER[state.status];
    if (ms === undefined) return;
    const timer = setTimeout(() => {
      reset();
      setCode('');
    }, ms);
    return () => clearTimeout(timer);
  }, [state.status, reset]);

  // After a failed delivery, "Not delivered" first, then the refund message.
  useEffect(() => {
    if (undeliveredId === null) return;
    const timer = setTimeout(() => setRefundShownFor(undeliveredId), UNDELIVERED_STEP_MS);
    return () => clearTimeout(timer);
  }, [undeliveredId]);

  const press = (key: Key) => {
    const s = state.status;
    if (s === 'requesting' || s === 'authorising' || s === 'dispensing') return;
    const finished = s === 'failed' || s === 'delivered' || s === 'undelivered';

    if (key === 'C' || key === '⌫') {
      if (s === 'waiting_tap') {
        void cancel();
        setCode('');
      } else if (finished || key === 'C') {
        clear();
      } else {
        setCode(code.slice(0, -1));
        setError(null);
      }
      return;
    }

    if (s === 'waiting_tap') return;
    // A digit after a finished or failed sale starts a fresh code.
    if (finished) reset();
    const base = s === 'idle' && code.length < CODE_LENGTH ? code : '';
    const next = base + key;
    setError(null);
    setCode(next);
    if (next.length < CODE_LENGTH) return;

    const product = findProduct(next);
    if (!product || product.soldOut) {
      setCode('');
      setError(product ? 'Sold out' : 'Invalid code');
      return;
    }
    void pay({
      spot: 'pro',
      productCode: product.code,
      amountCents: product.priceCents,
      label: `${product.code} · ${product.name}`,
    });
  };

  /** Ends the delivery animation, either the drop or the jam, and reports it. */
  const deliveryEnded = (success: boolean) => {
    if (!success) setFailNextDelivery(false);
    void finishDispense(success);
  };

  return {
    state,
    code,
    error,
    selected,
    dropping,
    dispensing,
    flying,
    jamming,
    waitingTap,
    refundShown,
    canSimulateTap,
    failNextDelivery,
    // Locked mid-delivery so the animation cannot change under the visitor.
    canToggleFailure: !dispensing,
    toggleFailNextDelivery: () => setFailNextDelivery((on) => !on),
    press,
    clear,
    simulateTap,
    onDropEnd: () => deliveryEnded(true),
    onJamEnd: () => deliveryEnded(false),
  };
}
