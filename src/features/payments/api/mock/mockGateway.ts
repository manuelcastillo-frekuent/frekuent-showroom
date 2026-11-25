import type { PaymentEvent, PaymentGateway, PaymentRequest } from '../../domain/types';

interface MockOptions {
  /** How long "Authorising…" lasts after the simulated tap. */
  authoriseMs?: number;
  /** Mirrors the firmware's T_pay: the Spot gives up waiting for a card. */
  tapTimeoutMs?: number;
}

interface OpenPayment {
  productCode: string;
  onEvent: (event: PaymentEvent) => void;
  timers: ReturnType<typeof setTimeout>[];
}

/**
 * In-process stand-in for the payment services. Used for demo mode (fairs with
 * no network) and for building the UI before backend and firmware are ready.
 * There is no real Spot here, so the tap is triggered from the screen.
 */
export class MockGateway implements PaymentGateway {
  readonly kind = 'mock' as const;
  private readonly authoriseMs: number;
  private readonly tapTimeoutMs: number;
  private open = new Map<string, OpenPayment>();
  private seq = 0;

  constructor(options: MockOptions = {}) {
    this.authoriseMs = options.authoriseMs ?? 1300;
    this.tapTimeoutMs = options.tapTimeoutMs ?? 60_000;
  }

  async start(request: PaymentRequest, onEvent: (event: PaymentEvent) => void) {
    const paymentId = `mock-${++this.seq}`;
    const timeout = setTimeout(() => {
      this.finish(paymentId, { type: 'failed', paymentId, reason: 'timeout' });
    }, this.tapTimeoutMs);
    this.open.set(paymentId, { productCode: request.productCode, onEvent, timers: [timeout] });
    queueMicrotask(() => onEvent({ type: 'waiting_tap', paymentId }));
    return paymentId;
  }

  /** Demo-only: what a visitor tapping the physical Spot would trigger. */
  simulateTap(paymentId: string, method: 'card' | 'wallet' = 'card') {
    const payment = this.open.get(paymentId);
    if (!payment) return;
    payment.timers.forEach(clearTimeout);
    payment.onEvent({ type: 'authorising', paymentId });
    payment.timers = [
      setTimeout(() => {
        const authCode = Math.random().toString(16).slice(2, 8).toUpperCase();
        // Like the real server: approval and the dispense order in one message.
        payment.onEvent({
          type: 'dispense',
          paymentId,
          productCode: payment.productCode,
          authCode,
          method,
        });
      }, this.authoriseMs),
    ];
  }

  async cancel(paymentId: string) {
    this.finish(paymentId, { type: 'failed', paymentId, reason: 'cancelled' });
  }

  async confirmDispense(paymentId: string) {
    // Nothing to settle or refund: no money moved.
    this.finish(paymentId);
  }

  private finish(paymentId: string, event?: PaymentEvent) {
    const payment = this.open.get(paymentId);
    if (!payment) return;
    payment.timers.forEach(clearTimeout);
    this.open.delete(paymentId);
    if (event) payment.onEvent(event);
  }
}
