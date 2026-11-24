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
 * `dispense` is the server's order to deliver: the screen never dispenses on
 * its own just because a payment was approved.
 */
export type PaymentEvent =
  | { type: 'waiting_tap'; paymentId: string }
  | { type: 'authorising'; paymentId: string }
  | { type: 'approved'; paymentId: string; authCode: string; method: 'card' | 'wallet' }
  | { type: 'dispense'; paymentId: string; productCode: string }
  | {
      type: 'failed';
      paymentId: string;
      reason: 'declined' | 'rejected' | 'timeout' | 'cancelled' | 'offline';
    };

export interface PaymentGateway {
  readonly kind: 'mock' | 's2s';
  /** Sends the sale request for the Spot and streams that payment's events. */
  start(request: PaymentRequest, onEvent: (event: PaymentEvent) => void): Promise<string>;
  cancel(paymentId: string): Promise<void>;
  /** Tells the server the product was delivered, once the drop animation ends. */
  confirmDispense(paymentId: string, success: boolean): Promise<void>;
}
