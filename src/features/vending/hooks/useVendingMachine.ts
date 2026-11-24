import { useEffect, useState } from 'react';
import { usePayment } from '@/features/payments';
import { CODE_LENGTH, type Key } from '../domain/keypad';
import { findProduct } from '../domain/products';

/** How long the result stays on screen before the machine clears itself. */
const FAILED_RESET_MS = 3500;
const DELIVERED_RESET_MS = 8000;

/**
 * Everything the vending machine does: the typed code, keypad rules, starting
 * the payment and clearing up afterwards. Components only render its output.
 */
export function useVendingMachine() {
  const { state, pay, cancel, finishDispense, reset, simulateTap, canSimulateTap } = usePayment();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selected =
    state.status === 'idle' ? null : (findProduct(state.request.productCode) ?? null);
  const dropping =
    selected !== null && (state.status === 'dispensing' || state.status === 'delivered');
  const waitingTap = state.status === 'waiting_tap';

  const clear = () => {
    reset();
    setCode('');
    setError(null);
  };

  // Return to a clean machine after a failure or once the item has been taken.
  useEffect(() => {
    if (state.status !== 'failed' && state.status !== 'delivered') return;
    const timer = setTimeout(
      () => {
        reset();
        setCode('');
      },
      state.status === 'failed' ? FAILED_RESET_MS : DELIVERED_RESET_MS,
    );
    return () => clearTimeout(timer);
  }, [state.status, reset]);

  const press = (key: Key) => {
    const s = state.status;
    if (s === 'requesting' || s === 'authorising' || s === 'approved' || s === 'dispensing') return;

    if (key === 'C' || key === '⌫') {
      if (s === 'waiting_tap') {
        void cancel();
        setCode('');
      } else if (s === 'failed' || s === 'delivered' || key === 'C') {
        clear();
      } else {
        setCode(code.slice(0, -1));
        setError(null);
      }
      return;
    }

    if (s === 'waiting_tap') return;
    // A digit after a finished or failed sale starts a fresh code.
    if (s === 'failed' || s === 'delivered') reset();
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

  return {
    state,
    code,
    error,
    selected,
    dropping,
    waitingTap,
    canSimulateTap,
    press,
    clear,
    simulateTap,
    onDropEnd: () => void finishDispense(true),
  };
}
