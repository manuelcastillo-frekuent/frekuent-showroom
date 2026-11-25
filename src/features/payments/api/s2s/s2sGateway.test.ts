import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentEvent, PaymentRequest } from '../../domain/types';
import type { MachineLink, PaymentWatch } from './machineChannel';
import { createPaymentsApi, type PaymentsApi } from './paymentsApi';
import type { PaymentStatus } from './protocol';
import { S2sGateway } from './s2sGateway';

const request: PaymentRequest = {
  spot: 'pro',
  productCode: '21',
  amountCents: 160,
  label: '21 · Cola',
};

/** Payments service whose status the test sets; `null` makes the poll fail. */
function fakeApi() {
  let status: PaymentStatus | null = 'waiting_tap';
  const api = {
    createSale: vi.fn(async () => 'p1'),
    getStatus: vi.fn(async (paymentId: string) => {
      if (status === null) throw new Error('network');
      return { paymentId, status };
    }),
    cancel: vi.fn(async () => undefined),
  } satisfies PaymentsApi;
  return { api, setStatus: (s: PaymentStatus | null) => (status = s) };
}

function fakeChannel(open = true) {
  const watches = new Map<string, PaymentWatch>();
  const results: [string, boolean][] = [];
  const channel: MachineLink = {
    whenOpen: () => (open ? Promise.resolve() : Promise.reject(new Error('offline'))),
    watch: (id, w) => void watches.set(id, w),
    forget: (id) => void watches.delete(id),
    sendResult: (id, success) => void results.push([id, success]),
  };
  const order = () =>
    watches.get('p1')?.onOrder({
      type: 'dispense',
      paymentId: 'p1',
      productCode: '21',
      authCode: 'AB12',
      method: 'card',
    });
  return { channel, watches, results, order, drop: () => watches.get('p1')?.onDrop() };
}

async function started(options = {}) {
  const { api, setStatus } = fakeApi();
  const ch = fakeChannel();
  const gw = new S2sGateway(api, ch.channel, { pollMs: 100, ...options });
  const events: PaymentEvent[] = [];
  const paymentId = await gw.start(request, (e) => events.push(e));
  return { gw, api, setStatus, ch, events, paymentId };
}

const tick = (ms = 100) => vi.advanceTimersByTimeAsync(ms);
const types = (events: PaymentEvent[]) => events.map((e) => e.type);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('S2sGateway (happy path)', () => {
  it('opens the sale by POST and returns its paymentId', async () => {
    const { api, paymentId } = await started();
    expect(paymentId).toBe('p1');
    expect(api.createSale).toHaveBeenCalledWith(
      expect.objectContaining({ spot: 'pro', productCode: '21', amountCents: 160 }),
    );
  });

  it('polls the status and reports each change once', async () => {
    const { setStatus, events } = await started();
    await tick();
    await tick();
    setStatus('authorising');
    await tick();
    await tick();
    expect(types(events)).toEqual(['waiting_tap', 'authorising']);
  });

  it('waits for the order on the channel, then stops polling', async () => {
    const { api, setStatus, ch, events } = await started();
    setStatus('approved');
    await tick();
    expect(types(events)).toEqual([]);
    ch.order();
    expect(events.at(-1)).toMatchObject({ type: 'dispense', authCode: 'AB12', method: 'card' });
    const polls = api.getStatus.mock.calls.length;
    await tick(1_000);
    expect(api.getStatus.mock.calls.length).toBe(polls);
  });

  it('sends a successful dispense result and forgets the payment', async () => {
    const { gw, ch } = await started();
    ch.order();
    await gw.confirmDispense('p1', true);
    expect(ch.results).toEqual([['p1', true]]);
    expect(ch.watches.has('p1')).toBe(false);
  });
});

describe('S2sGateway (failed delivery)', () => {
  it('sends success=false and closes the cycle without polling for the refund', async () => {
    const { gw, ch, api, events } = await started();
    ch.order();
    const polls = api.getStatus.mock.calls.length;
    await gw.confirmDispense('p1', false);
    expect(ch.results).toEqual([['p1', false]]);
    expect(ch.watches.has('p1')).toBe(false);
    await tick(1_000);
    expect(api.getStatus.mock.calls.length).toBe(polls);
    expect(types(events)).toEqual(['dispense']);
  });
});

describe('S2sGateway (payment failures)', () => {
  it('fails up front when the machine channel is down', async () => {
    const { api } = fakeApi();
    const gw = new S2sGateway(api, fakeChannel(false).channel);
    await expect(gw.start(request, () => undefined)).rejects.toThrow('offline');
    expect(api.createSale).not.toHaveBeenCalled();
  });

  it('maps a closed payment to its reason', async () => {
    const { setStatus, events } = await started();
    setStatus('declined');
    await tick();
    expect(events.at(-1)).toEqual({ type: 'failed', paymentId: 'p1', reason: 'declined' });
  });

  it('asks to cancel and waits for polling to confirm it', async () => {
    const { gw, api, setStatus, events } = await started();
    await gw.cancel('p1');
    expect(api.cancel).toHaveBeenCalledWith('p1');
    expect(types(events)).toEqual([]);
    setStatus('cancelled');
    await tick();
    expect(events.at(-1)).toMatchObject({ type: 'failed', reason: 'cancelled' });
  });

  it('gives the payment up as offline after repeated failed polls', async () => {
    const { setStatus, events } = await started({ maxPollErrors: 3 });
    setStatus(null);
    await tick(200);
    expect(types(events)).toEqual([]);
    await tick();
    expect(events.at(-1)).toMatchObject({ type: 'failed', reason: 'offline' });
  });

  it('fails the payment as offline if the channel drops', async () => {
    const { ch, events } = await started();
    ch.drop();
    expect(events.at(-1)).toMatchObject({ type: 'failed', reason: 'offline' });
  });
});

describe('createPaymentsApi', () => {
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });

  it('posts the sale and reads the paymentId', async () => {
    const fetchFn = vi.fn(async () => reply(201, { paymentId: 'p1' }));
    const api = createPaymentsApi('http://api/', fetchFn);
    const body = { requestId: 'r', spot: 'pro', productCode: '21', amountCents: 160 } as const;
    await expect(api.createSale(body)).resolves.toBe('p1');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://api/sales',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
    );
  });

  it('rejects an HTTP error or a reply outside the contract', async () => {
    const offline = createPaymentsApi('http://api', async () => reply(409, { error: 'offline' }));
    await expect(offline.getStatus('p1')).rejects.toThrow('409');
    const odd = createPaymentsApi('http://api', async () =>
      reply(200, { paymentId: 'p1', status: 'exploded' }),
    );
    await expect(odd.getStatus('p1')).rejects.toThrow('status');
  });
});
