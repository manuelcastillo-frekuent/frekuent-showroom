import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentEvent, PaymentRequest } from '../../domain/types';
import { memoryChargeStore } from './openCharge';
import type { PaymentsApi } from './paymentsApi';
import { ApiError, type PaymentStatus, type StatusReply } from './protocol';
import { ChargeUnavailableError, S2sGateway } from './s2sGateway';
import { pollingStatusSource } from './statusSource';

const request: PaymentRequest = {
  spot: 'pro',
  productCode: '21',
  amountCents: 160,
  label: '21 · Cola',
};

const fail = (http: number, code: number, error = 'e') => new ApiError(http, code, error, error);

/** A Payments API whose charge status the test drives. */
function fakeApi() {
  let status: PaymentStatus = 'pending';
  let statusFails = false;
  const charge = () => ({ transaction_uuid: 'u1', status, status_code: 0 });
  const api = {
    create: vi.fn(async () => charge()),
    pay: vi.fn(async () => {
      status = 'in_progress';
      return charge();
    }),
    status: vi.fn(async () => {
      if (statusFails) throw new TypeError('Failed to fetch');
      return charge() as StatusReply;
    }),
    dispense: vi.fn<(uuid: string, success: boolean) => Promise<void>>(async () => undefined),
    cancel: vi.fn(async () => {
      if (status !== 'pending' && status !== 'in_progress') throw fail(409, 409, 'not_cancellable');
      status = 'cancelled';
      return charge();
    }),
    list: vi.fn(async () => ({ items: [] as StatusReply[], total: 0 })),
  } satisfies PaymentsApi;
  return {
    api,
    set: (s: PaymentStatus) => (status = s),
    netDown: (down: boolean) => (statusFails = down),
  };
}

function setup(options: { payWaitMs?: number } = {}) {
  const fake = fakeApi();
  const store = memoryChargeStore();
  const source = pollingStatusSource(fake.api, { pollMs: 100 });
  const gw = new S2sGateway(fake.api, source, store, {
    deviceSerial: 105640,
    payWaitMs: options.payWaitMs ?? 10_000,
    settleWaitMs: 5_000,
    dispenseRetriesMs: [100, 200, 400],
  });
  const events: PaymentEvent[] = [];
  return { ...fake, gw, store, events, onEvent: (e: PaymentEvent) => events.push(e) };
}

const tick = (ms = 100) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('S2sGateway · happy path', () => {
  it('creates and pays in one go, with the product and the Spot serial', async () => {
    const { gw, api, onEvent, store } = setup();
    await expect(gw.start(request, onEvent)).resolves.toBe('u1');
    expect(api.create).toHaveBeenCalledWith({
      amount: 160,
      device_serial: 105640,
      product_description: '21 · Cola',
    });
    expect(api.pay).toHaveBeenCalledWith('u1');
    expect(store.load()).toEqual({ uuid: 'u1', phase: 'paying' });
  });

  it('takes `authorized` as the order to dispense', async () => {
    const { gw, set, events, onEvent, store } = setup();
    await gw.start(request, onEvent);
    await tick();
    expect(events).toEqual([]);
    set('authorized');
    await tick();
    expect(events).toEqual([{ type: 'dispense', paymentId: 'u1', productCode: '21' }]);
    expect(store.load()?.phase).toBe('dispensing');
  });

  it('reports the delivery once and follows it to `completed` in the background', async () => {
    const { gw, api, set, onEvent, store } = setup();
    await gw.start(request, onEvent);
    set('authorized');
    await tick();
    await gw.confirmDispense('u1', true);
    expect(api.dispense).toHaveBeenCalledExactlyOnceWith('u1', true);
    expect(store.load()?.phase).toBe('reported');
    set('completed');
    await tick(200);
    expect(store.load()).toBeNull();
  });

  it('waits for the previous charge to settle before creating the next one', async () => {
    const { gw, api, set, onEvent } = setup();
    await gw.start(request, onEvent);
    set('authorized');
    await tick();
    await gw.confirmDispense('u1', true);
    let started = false;
    void gw.start(request, onEvent).then(() => (started = true));
    await tick(300);
    expect(api.create).toHaveBeenCalledTimes(1);
    set('completed');
    await tick(300);
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(started).toBe(true);
  });
});

describe('S2sGateway · /dispense', () => {
  it('sends success=false for a failed delivery', async () => {
    const { gw, api, set, onEvent } = setup();
    await gw.start(request, onEvent);
    set('authorized');
    await tick();
    await gw.confirmDispense('u1', false);
    expect(api.dispense).toHaveBeenCalledWith('u1', false);
  });

  it('retries with the same success on network errors and "not authorized yet"', async () => {
    const { gw, api } = setup();
    api.dispense
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(fail(409, 410, 'not_completed'));
    const sent = gw.confirmDispense('u1', true);
    await tick(400);
    await sent;
    expect(api.dispense).toHaveBeenCalledTimes(3);
    expect(api.dispense.mock.calls.every(([, success]) => success === true)).toBe(true);
  });

  it.each([
    [409, 415, 'dispense_in_progress'],
    [409, 412, 'already_refunded'],
    [409, 414, 'payment_expired'],
  ])('stops on %i·%i %s: it already arrived or no longer matters', async (http, code, error) => {
    const { gw, api } = setup();
    api.dispense.mockRejectedValueOnce(fail(http, code, error));
    await gw.confirmDispense('u1', true);
    expect(api.dispense).toHaveBeenCalledTimes(1);
  });
});

describe('S2sGateway · cancel and failures', () => {
  it('cancels with USER_ABORT and reports it at once', async () => {
    const { gw, api, events, onEvent, store } = setup();
    await gw.start(request, onEvent);
    await gw.cancel('u1');
    expect(api.cancel).toHaveBeenCalledWith('u1', 'USER_ABORT');
    expect(events).toEqual([{ type: 'failed', paymentId: 'u1', reason: 'cancelled' }]);
    expect(store.load()).toBeNull();
  });

  it('keeps the sale going when they had already paid (not cancellable)', async () => {
    const { gw, set, events, onEvent } = setup();
    await gw.start(request, onEvent);
    set('authorized');
    await gw.cancel('u1');
    expect(events).toEqual([]);
    await tick();
    expect(events.at(-1)).toMatchObject({ type: 'dispense' });
  });

  it.each([
    ['failed', 'declined'],
    ['timeout', 'timeout'],
    ['cancelled', 'cancelled'],
    ['refunded', 'refunded'],
  ] as const)('maps %s to the %s failure', async (status, reason) => {
    const { gw, set, events, onEvent } = setup();
    await gw.start(request, onEvent);
    set(status);
    await tick();
    expect(events).toEqual([{ type: 'failed', paymentId: 'u1', reason }]);
  });

  it('cancels with TIMEOUT when nobody answers in time', async () => {
    const { gw, api, events, onEvent } = setup({ payWaitMs: 1_000 });
    await gw.start(request, onEvent);
    await tick(1_200);
    expect(api.cancel).toHaveBeenCalledWith('u1', 'TIMEOUT');
    expect(events.at(-1)).toMatchObject({ type: 'failed', reason: 'cancelled' });
  });

  it('rides out a network cut during the polling', async () => {
    const { gw, set, netDown, events, onEvent } = setup();
    await gw.start(request, onEvent);
    netDown(true);
    await tick(500);
    set('authorized');
    netDown(false);
    await tick(200);
    expect(events.at(-1)).toMatchObject({ type: 'dispense' });
  });

  it('turns 403 configuration and a disconnected Spot into "unavailable"', async () => {
    for (const error of [
      fail(403, 204, 'unregistered_device'),
      fail(409, 402, 'device_not_connected'),
    ]) {
      const { gw, api, onEvent } = setup();
      api.create.mockRejectedValueOnce(error);
      await expect(gw.start(request, onEvent)).rejects.toBeInstanceOf(ChargeUnavailableError);
    }
  });

  it('cancels with DEVICE_ERROR when /pay is refused', async () => {
    const { gw, api, onEvent, store } = setup();
    api.pay.mockRejectedValueOnce(fail(409, 409, 'invalid_state'));
    await expect(gw.start(request, onEvent)).rejects.toThrow('invalid_state');
    expect(api.cancel).toHaveBeenCalledWith('u1', 'DEVICE_ERROR');
    expect(store.load()).toBeNull();
  });
});

describe('S2sGateway · recovery', () => {
  it('on a 409 conflict, frees the orphan and creates again', async () => {
    const { gw, api, onEvent } = setup();
    api.create.mockRejectedValueOnce(fail(409, 400, 'conflict'));
    api.list.mockResolvedValueOnce({
      items: [{ transaction_uuid: 'old', status: 'in_progress' } as StatusReply],
      total: 1,
    });
    api.status.mockResolvedValueOnce({
      transaction_uuid: 'old',
      status: 'in_progress',
    } as StatusReply);
    await expect(gw.start(request, onEvent)).resolves.toBe('u1');
    expect(api.cancel).toHaveBeenCalledWith('old', 'DEVICE_ERROR');
    expect(api.create).toHaveBeenCalledTimes(2);
  });

  it('at startup, gives back an authorized charge the visitor never saw delivered', async () => {
    const { gw, api, store } = setup();
    store.save({ uuid: 'old', phase: 'dispensing' });
    api.status.mockResolvedValueOnce({
      transaction_uuid: 'old',
      status: 'authorized',
    } as StatusReply);
    await gw.recover();
    expect(api.dispense).toHaveBeenCalledWith('old', false);
    expect(store.load()).toBeNull();
  });

  it('at startup, leaves alone a charge whose delivery was already reported', async () => {
    const { gw, api, store } = setup();
    store.save({ uuid: 'old', phase: 'reported' });
    api.status.mockResolvedValueOnce({
      transaction_uuid: 'old',
      status: 'authorized',
    } as StatusReply);
    await gw.recover();
    expect(api.dispense).not.toHaveBeenCalled();
  });
});
