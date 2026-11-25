import type { PaymentEvent, PaymentGateway, PaymentRequest } from '../../domain/types';
import type { DispenseOrder, MachineLink } from './machineChannel';
import type { PaymentsApi } from './paymentsApi';
import type { PaymentStatus } from './protocol';

export interface PollOptions {
  /** Time between status polls. */
  pollMs?: number;
  /** Consecutive failed polls before the payment is given up as offline. */
  maxPollErrors?: number;
}

interface OpenPayment {
  onEvent: (event: PaymentEvent) => void;
  phase: 'paying' | 'dispensing';
  lastStatus?: PaymentStatus;
  errors: number;
  timer?: ReturnType<typeof setTimeout>;
}

const FAILED: Partial<Record<PaymentStatus, 'declined' | 'rejected' | 'timeout' | 'cancelled'>> = {
  declined: 'declined',
  rejected: 'rejected',
  timeout: 'timeout',
  cancelled: 'cancelled',
};

/**
 * Real payments with no BFF: the sale is opened and followed over HTTP
 * (POST, then status polling, since nothing pushes the progress), and the
 * dispense order arrives on the machine channel, which also carries the
 * dispense result back. Polling stops once the order arrives, and the
 * dispense result closes the cycle: after a failed delivery the backend
 * refunds on its own, so the screen does not ask about it.
 */
export class S2sGateway implements PaymentGateway {
  readonly kind = 's2s' as const;
  private open = new Map<string, OpenPayment>();
  private readonly pollMs: number;
  private readonly maxPollErrors: number;

  constructor(
    private readonly api: PaymentsApi,
    private readonly channel: MachineLink,
    options: PollOptions = {},
  ) {
    this.pollMs = options.pollMs ?? 1_000;
    this.maxPollErrors = options.maxPollErrors ?? 5;
  }

  async start(request: PaymentRequest, onEvent: (event: PaymentEvent) => void) {
    // Without the channel the dispense order could never arrive: fail up front.
    await this.channel.whenOpen();
    const paymentId = await this.api.createSale({
      requestId: crypto.randomUUID(),
      spot: request.spot,
      productCode: request.productCode,
      amountCents: request.amountCents,
    });
    const payment: OpenPayment = { onEvent, phase: 'paying', errors: 0 };
    this.open.set(paymentId, payment);
    this.channel.watch(paymentId, {
      onOrder: (order) => this.onOrder(paymentId, order),
      onDrop: () => this.finish(paymentId, { type: 'failed', paymentId, reason: 'offline' }),
    });
    this.schedulePoll(paymentId, payment);
    return paymentId;
  }

  async cancel(paymentId: string) {
    // The screen leaves waiting_tap only when polling shows `cancelled`: the
    // visitor may have tapped meanwhile.
    await this.api.cancel(paymentId).catch((error: unknown) => {
      console.warn('[showroom] cancel failed', error);
    });
  }

  async confirmDispense(paymentId: string, success: boolean) {
    this.channel.sendResult(paymentId, success);
    this.finish(paymentId);
  }

  private onOrder(paymentId: string, order: DispenseOrder) {
    const payment = this.open.get(paymentId);
    if (!payment || payment.phase !== 'paying') return;
    payment.phase = 'dispensing';
    clearTimeout(payment.timer);
    payment.onEvent({
      type: 'dispense',
      paymentId,
      productCode: order.productCode,
      authCode: order.authCode,
      method: order.method,
    });
  }

  private schedulePoll(paymentId: string, payment: OpenPayment) {
    clearTimeout(payment.timer);
    payment.timer = setTimeout(() => void this.poll(paymentId, payment), this.pollMs);
  }

  /** Closed, or waiting on the channel instead of on polling. */
  private stale(paymentId: string, payment: OpenPayment) {
    return this.open.get(paymentId) !== payment || payment.phase === 'dispensing';
  }

  private async poll(paymentId: string, payment: OpenPayment) {
    if (this.stale(paymentId, payment)) return;
    let status: PaymentStatus;
    try {
      status = (await this.api.getStatus(paymentId)).status;
      payment.errors = 0;
    } catch (error) {
      console.warn('[showroom] status poll failed', error);
      if (this.stale(paymentId, payment)) return;
      payment.errors += 1;
      if (payment.errors >= this.maxPollErrors)
        return this.finish(paymentId, { type: 'failed', paymentId, reason: 'offline' });
      return this.schedulePoll(paymentId, payment);
    }
    // The order may have arrived, or the payment closed, while the poll was out.
    if (this.stale(paymentId, payment)) return;

    const failed = FAILED[status];
    if (failed) return this.finish(paymentId, { type: 'failed', paymentId, reason: failed });
    if ((status === 'waiting_tap' || status === 'authorising') && status !== payment.lastStatus)
      payment.onEvent({ type: status, paymentId });
    // approved / completed: keep waiting for the order on the machine channel.
    payment.lastStatus = status;
    this.schedulePoll(paymentId, payment);
  }

  private finish(paymentId: string, event?: PaymentEvent) {
    const payment = this.open.get(paymentId);
    if (!payment) return;
    clearTimeout(payment.timer);
    this.open.delete(paymentId);
    this.channel.forget(paymentId);
    if (event) payment.onEvent(event);
  }
}
