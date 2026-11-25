export type SpotModel = 'pro' | 'compact' | 'mini';

export interface PaymentRequest {
  spot: SpotModel;
  /** Product the machine will dispense; the server echoes it in the dispense order. */
  productCode: string;
  /** Minor units (cents) to avoid float rounding in amounts. */
  amountCents: number;
  /** Product shown to the visitor; the Spot APK cannot display it (spec O7). */
  label: string;
}

/**
 * What the screen reacts to for one payment, whichever gateway produced it.
 * `dispense` is the server's order to deliver and carries the approval with
 * it: the screen never dispenses on its own.
 */
export type PaymentEvent =
  | { type: 'waiting_tap'; paymentId: string }
  | { type: 'authorising'; paymentId: string }
  | {
      type: 'dispense';
      paymentId: string;
      productCode: string;
      authCode: string;
      method: 'card' | 'wallet';
    }
  | {
      type: 'failed';
      paymentId: string;
      reason: 'declined' | 'rejected' | 'timeout' | 'cancelled' | 'offline';
    };

export interface PaymentGateway {
  readonly kind: 'mock' | 's2s';
  /** Opens the sale on the Spot and reports that payment's events. */
  start(request: PaymentRequest, onEvent: (event: PaymentEvent) => void): Promise<string>;
  cancel(paymentId: string): Promise<void>;
  /**
   * Reports how the delivery went once its animation ends. This closes the
   * cycle: with `false` the backend refunds on its own and the screen does not
   * follow the payment any further.
   */
  confirmDispense(paymentId: string, success: boolean): Promise<void>;
}
