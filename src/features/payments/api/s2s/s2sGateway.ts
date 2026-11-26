import type { PaymentEvent, PaymentGateway, PaymentRequest } from '../../domain/types';
import type { ChargeStore } from './openCharge';
import type { PaymentsApi } from './paymentsApi';
import {
  ApiError,
  ERR,
  FINAL_STATUSES,
  FORBIDDEN_CONFIG_CODES,
  type CancelReason,
  type PaymentStatus,
} from './protocol';
import type { PaymentStatusSource } from './statusSource';

/**
 * The real Spot cannot take this charge (403 configuration, or the Spot is not
 * connected): the screen should carry on in simulated mode (brief §11).
 */
export class ChargeUnavailableError extends Error {
  constructor(readonly cause: ApiError) {
    super(`Charging unavailable: ${cause.message}`);
    this.name = 'ChargeUnavailableError';
  }
}

export interface S2sOptions {
  deviceSerial: number;
  /** Longest wait for the visitor's card before cancelling with TIMEOUT (brief §8: 100 s). */
  payWaitMs?: number;
  /** Bookkeeping wait for `completed`/`refunded` after /dispense (brief §8: 120 s). */
  settleWaitMs?: number;
  /** Waits between /dispense attempts (brief §10: 1 s, 2 s, 4 s). */
  dispenseRetriesMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface Charge {
  uuid: string;
  request: PaymentRequest;
  onEvent: (event: PaymentEvent) => void;
  watch: AbortController;
  done: boolean;
}

const WAIT_PAY: readonly PaymentStatus[] = [
  'authorized',
  'completed',
  'failed',
  'cancelled',
  'timeout',
  'refunded',
];

const FAIL_REASON: Partial<
  Record<PaymentStatus, Extract<PaymentEvent, { type: 'failed' }>['reason']>
> = {
  failed: 'declined',
  cancelled: 'cancelled',
  timeout: 'timeout',
  refunded: 'refunded',
  completed: 'rejected',
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isNetworkError = (e: unknown) => !(e instanceof ApiError);

/**
 * Real charges on the Spot through the Payments API, following a vending
 * machine's real flow (brief QIM-488):
 *
 *   /create + /pay → poll /status → `authorized` = dispense now → animation →
 *   /dispense {success} → (background) poll until `completed` / `refunded`.
 *
 * One charge open at a time. The open charge is persisted, so a restart (or a
 * 409 conflict on /create) can leave the Spot free again (§10).
 */
export class S2sGateway implements PaymentGateway {
  readonly kind = 's2s' as const;
  private charges = new Map<string, Charge>();
  /** The previous charge's bookkeeping and the startup recovery: /create waits for both. */
  private settling: Promise<void> = Promise.resolve();
  private readonly payWaitMs: number;
  private readonly settleWaitMs: number;
  private readonly dispenseRetriesMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly api: PaymentsApi,
    private readonly source: PaymentStatusSource,
    private readonly store: ChargeStore,
    private readonly options: S2sOptions,
  ) {
    this.payWaitMs = options.payWaitMs ?? 100_000;
    this.settleWaitMs = options.settleWaitMs ?? 120_000;
    this.dispenseRetriesMs = options.dispenseRetriesMs ?? [1_000, 2_000, 4_000];
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  /** Startup: leaves free whatever a previous run left open on the Spot. */
  recover(): Promise<void> {
    this.settling = this.settling.then(() => this.recoverOrphans()).catch(() => undefined);
    return this.settling;
  }

  async start(request: PaymentRequest, onEvent: (event: PaymentEvent) => void) {
    await this.settling;
    const uuid = await this.createCharge(request);
    this.store.save({ uuid, phase: 'created' });
    try {
      await this.payCharge(uuid);
    } catch (error) {
      await this.cancelCharge(uuid, 'DEVICE_ERROR').catch(() => undefined);
      this.store.clear();
      throw error;
    }
    this.store.save({ uuid, phase: 'paying' });
    const charge: Charge = { uuid, request, onEvent, watch: new AbortController(), done: false };
    this.charges.set(uuid, charge);
    void this.watchPayment(charge);
    return uuid;
  }

  async cancel(uuid: string) {
    const charge = this.charges.get(uuid);
    if (!charge || charge.done) return;
    const status = await this.cancelCharge(uuid, 'USER_ABORT').catch(() => null);
    // Not cancellable means they had already paid: the polling carries on with that.
    if (status === 'cancelled')
      this.finish(charge, { type: 'failed', paymentId: uuid, reason: 'cancelled' });
  }

  async confirmDispense(uuid: string, success: boolean) {
    await this.reportDispense(uuid, success);
    this.store.save({ uuid, phase: 'reported' });
    // Bookkeeping only: the visitor has already finished. /create waits for it,
    // so the next charge never meets this one still open on the Spot.
    this.settling = this.settling
      .then(() =>
        this.source.waitFor(uuid, ['completed', 'refunded'], { maxMs: this.settleWaitMs }),
      )
      .then((final) => console.info(`[showroom] charge ${uuid} settled as ${final ?? 'unknown'}`))
      .catch(() => undefined)
      .finally(() => {
        if (this.store.load()?.uuid === uuid) this.store.clear();
      });
  }

  private async watchPayment(charge: Charge): Promise<void> {
    const { uuid } = charge;
    let status = await this.source.waitFor(uuid, WAIT_PAY, {
      maxMs: this.payWaitMs,
      signal: charge.watch.signal,
    });
    if (charge.done) return;
    // Nobody answered in time: free the Spot ourselves.
    if (status === null)
      status = await this.cancelCharge(uuid, 'TIMEOUT').catch(() => 'timeout' as const);
    if (charge.done) return;

    if (status === 'authorized') {
      this.store.save({ uuid, phase: 'dispensing' });
      charge.done = true;
      this.charges.delete(uuid);
      charge.onEvent({
        type: 'dispense',
        paymentId: uuid,
        productCode: charge.request.productCode,
      });
      return;
    }
    if (status === 'in_progress' || status === 'pending') {
      // A TIMEOUT cancel that lost to a late answer: keep waiting for it.
      return this.watchPayment(charge);
    }
    this.store.clear();
    this.finish(charge, {
      type: 'failed',
      paymentId: uuid,
      reason: FAIL_REASON[status] ?? 'rejected',
    });
  }

  private finish(charge: Charge, event: PaymentEvent) {
    if (charge.done) return;
    charge.done = true;
    charge.watch.abort();
    this.charges.delete(charge.uuid);
    this.store.clear();
    charge.onEvent(event);
  }

  /** /create, retried once on a network error; a 409 conflict recovers the orphan first. */
  private async createCharge(request: PaymentRequest): Promise<string> {
    const body = {
      amount: request.amountCents,
      device_serial: this.options.deviceSerial,
      product_description: request.label.slice(0, 255),
    };
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.api.create(body)).transaction_uuid;
      } catch (error) {
        if (error instanceof ApiError) {
          if (
            (error.httpStatus === 403 &&
              (FORBIDDEN_CONFIG_CODES as readonly (number | null)[]).includes(error.errorCode)) ||
            error.is(409, ERR.deviceNotConnected)
          )
            throw new ChargeUnavailableError(error);
          if (error.is(409, ERR.conflict) && attempt === 0) {
            await this.recoverOrphans();
            continue;
          }
          throw error;
        }
        if (attempt > 0) throw error;
      }
    }
  }

  /** /pay; after a network error, /status tells whether it arrived. */
  private async payCharge(uuid: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.api.pay(uuid);
        return;
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        const { status } = await this.api.status(uuid);
        if (status === 'in_progress') return;
        if (status !== 'pending')
          throw new Error(`Charge ${uuid} is ${status} after /pay`, { cause: error });
      }
    }
    throw new Error(`Charge ${uuid}: /pay did not go through`);
  }

  /**
   * /cancel; retried on a network error. "Not cancellable" (they already paid,
   * or it already ended) answers with the current status instead.
   */
  private async cancelCharge(uuid: string, reason: CancelReason): Promise<PaymentStatus> {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.api.cancel(uuid, reason)).status;
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.is(409)) return (await this.api.status(uuid)).status;
          throw error;
        }
        if (attempt >= 1) return (await this.api.status(uuid)).status;
      }
    }
  }

  /**
   * /dispense, once in intent: retried with the same `success` on a network
   * error, a 5xx or "not authorized yet", and settled by the codes that mean
   * it already arrived or no longer matters.
   */
  private async reportDispense(uuid: string, success: boolean) {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.api.dispense(uuid, success);
        return;
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.is(409, ERR.dispenseInProgress)) return; // our earlier try got there
          if (error.is(409, ERR.alreadyRefunded) || error.is(409, ERR.paymentExpired)) {
            console.warn(`[showroom] charge ${uuid} already refunded`, error);
            return;
          }
          const retryable = error.is(409, ERR.notCompleted) || error.httpStatus >= 500;
          if (!retryable) {
            console.error(`[showroom] /dispense rejected for ${uuid}`, error);
            return;
          }
        }
        if (attempt >= this.dispenseRetriesMs.length) {
          console.error(`[showroom] /dispense not sent for ${uuid}`, error);
          return;
        }
        await this.sleep(this.dispenseRetriesMs[attempt]!);
      }
    }
  }

  /**
   * Leaves the Spot free (§10): the persisted charge, or else today's open
   * charges on this Spot. Waiting → cancel; authorized and never reported →
   * /dispense false (the visitor never saw the product drop: give it back).
   */
  private async recoverOrphans() {
    const saved = this.store.load();
    const orphans: { uuid: string; reported: boolean }[] = [];
    if (saved) {
      orphans.push({ uuid: saved.uuid, reported: saved.phase === 'reported' });
    } else {
      const dateFrom = new Date(this.now() - 24 * 3600_000).toISOString();
      const { items } = await this.api.list({ dateFrom, deviceSerial: this.options.deviceSerial });
      for (const item of items)
        if (!FINAL_STATUSES.includes(item.status))
          orphans.push({ uuid: item.transaction_uuid, reported: false });
    }
    for (const { uuid, reported } of orphans) {
      if (this.charges.has(uuid)) continue;
      try {
        const { status } = await this.api.status(uuid);
        if (status === 'pending' || status === 'in_progress')
          await this.cancelCharge(uuid, 'DEVICE_ERROR');
        else if (status === 'authorized' && !reported) await this.reportDispense(uuid, false);
      } catch (error) {
        console.warn(`[showroom] could not recover charge ${uuid}`, error);
      }
    }
    this.store.clear();
  }
}
