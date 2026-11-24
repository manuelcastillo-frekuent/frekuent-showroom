import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paymentReducer, initialPaymentState } from '../../domain/machine';
import type { PaymentEvent, PaymentRequest } from '../../domain/types';
import { WsGateway, type ConnectionOptions, type SocketLike } from './wsGateway';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  private handlers: Record<string, ((event: { data: unknown }) => void)[]> = {};

  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    (this.handlers[type] ??= []).push(listener);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  open() {
    this.readyState = 1;
    this.handlers.open?.forEach((h) => h({ data: null }));
  }
  serverSends(message: Record<string, unknown>) {
    this.handlers.message?.forEach((h) => h({ data: JSON.stringify(message) }));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.handlers.close?.forEach((h) => h({ data: null }));
  }
}

const request: PaymentRequest = {
  spot: 'pro',
  productCode: '21',
  amountCents: 160,
  label: '21 · Cola',
};

const flush = () => vi.advanceTimersByTimeAsync(0);

/** A gateway whose sockets the test drives; `sockets.at(-1)` is the live one. */
function setup(options: ConnectionOptions = {}) {
  const sockets: FakeSocket[] = [];
  const gw = new WsGateway(
    'ws://test',
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    { connectTimeoutMs: 5_000, retryBaseMs: 1_000, retryMaxMs: 8_000, ...options },
  );
  return { gw, sockets, live: () => sockets.at(-1)! };
}

/** A connected gateway with one sale already accepted as `p1`. */
async function startedPayment() {
  const ctx = setup();
  ctx.gw.connect();
  ctx.live().open();
  const events: PaymentEvent[] = [];
  const started = ctx.gw.start(request, (e) => events.push(e));
  await flush();
  ctx.live().serverSends({
    type: 'sale_accepted',
    requestId: ctx.live().sent[0]!.requestId,
    paymentId: 'p1',
  });
  await started;
  return { ...ctx, socket: ctx.live(), events };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Retry delays use the full jittered range's upper bound, so tests are exact.
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WsGateway (happy path)', () => {
  it('sends the sale, follows the server and acknowledges the dispense', async () => {
    const { gw, events, socket } = await startedPayment();

    expect(socket.sent[0]).toMatchObject({
      type: 'sale_request',
      spot: 'pro',
      productCode: '21',
      amountCents: 160,
    });

    socket.serverSends({ type: 'payment_status', paymentId: 'p1', status: 'authorising' });
    socket.serverSends({
      type: 'payment_approved',
      paymentId: 'p1',
      authCode: 'AB12',
      method: 'card',
    });
    socket.serverSends({ type: 'dispense', paymentId: 'p1', productCode: '21' });
    expect(events.map((e) => e.type)).toEqual(['authorising', 'approved', 'dispense']);

    await gw.confirmDispense('p1', true);
    expect(socket.sent.at(-1)).toEqual({ type: 'dispense_result', paymentId: 'p1', success: true });
  });

  it('ignores messages that do not match the protocol', async () => {
    const { socket, events } = await startedPayment();
    socket.serverSends({ type: 'payment_status', paymentId: 'p1', status: 'exploded' });
    expect(events).toEqual([]);
  });
});

describe('WsGateway (connection)', () => {
  it('opens the socket on connect, before any sale', () => {
    const { gw, sockets } = setup();
    expect(sockets).toHaveLength(0);
    gw.connect();
    gw.connect();
    expect(sockets).toHaveLength(1);
    expect(gw.getStatus()).toBe('connecting');
    sockets[0]!.open();
    expect(gw.getStatus()).toBe('open');
  });

  it('lets a sale made while connecting wait for the socket to open', async () => {
    const { gw, live } = setup();
    gw.connect();
    const started = gw.start(request, () => undefined);
    await flush();
    expect(live().sent).toHaveLength(0);
    live().open();
    await flush();
    expect(live().sent[0]).toMatchObject({ type: 'sale_request' });
    live().serverSends({
      type: 'sale_accepted',
      requestId: live().sent[0]!.requestId,
      paymentId: 'p1',
    });
    await expect(started).resolves.toBe('p1');
  });

  it('fails a sale at once while the server is down', async () => {
    const { gw, live } = setup();
    gw.connect();
    live().close();
    expect(gw.getStatus()).toBe('down');
    await expect(gw.start(request, () => undefined)).rejects.toThrow('offline');
  });

  it('reconnects with a doubling delay and resets it once connected', async () => {
    const { gw, sockets, live } = setup();
    gw.connect();

    live().close();
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    live().close();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);

    live().open();
    expect(gw.getStatus()).toBe('open');
    live().close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(4);
  });

  it('caps the retry delay', async () => {
    // Long handshake timeout so only the retry delays drive this test.
    const { gw, sockets, live } = setup({ connectTimeoutMs: 60_000 });
    gw.connect();
    for (let i = 0; i < 6; i++) {
      live().close();
      await vi.advanceTimersByTimeAsync(8_000);
    }
    expect(sockets).toHaveLength(7);
  });

  it('abandons a handshake that never finishes and retries', async () => {
    const { gw, sockets } = setup();
    gw.connect();
    const started = gw.start(request, () => undefined);
    const rejected = expect(started).rejects.toThrow('offline');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets[0]!.readyState).toBe(3);
    expect(gw.getStatus()).toBe('down');
    await rejected;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
  });

  it('notifies status subscribers on every change', () => {
    const { gw, live } = setup();
    const seen: string[] = [];
    gw.subscribeStatus(() => seen.push(gw.getStatus()));
    gw.connect();
    live().open();
    live().close();
    expect(seen).toEqual(['connecting', 'open', 'down']);
  });
});

describe('WsGateway (failures)', () => {
  it('asks the server to cancel and waits for its confirmation', async () => {
    const { socket, gw, events } = await startedPayment();

    await gw.cancel('p1');
    expect(socket.sent.at(-1)).toEqual({ type: 'cancel_request', paymentId: 'p1' });
    expect(events).toEqual([]);

    socket.serverSends({ type: 'payment_failed', paymentId: 'p1', reason: 'cancelled' });
    expect(events).toEqual([{ type: 'failed', paymentId: 'p1', reason: 'cancelled' }]);
  });

  it('rejects the sale when the server cannot open the payment', async () => {
    const { gw, live } = setup();
    gw.connect();
    live().open();
    const started = gw.start(request, () => undefined);
    await flush();
    live().serverSends({
      type: 'sale_rejected',
      requestId: live().sent[0]!.requestId,
      reason: 'offline',
    });
    await expect(started).rejects.toThrow('rejected');
  });

  it('fails the waiting sale if the socket drops before it is accepted', async () => {
    const { gw, live } = setup();
    gw.connect();
    live().open();
    const started = gw.start(request, () => undefined);
    await flush();
    live().close();
    await expect(started).rejects.toThrow('offline');
  });

  it('fails the open payment as offline if the socket drops', async () => {
    const { socket, events } = await startedPayment();
    socket.close();
    expect(events).toEqual([{ type: 'failed', paymentId: 'p1', reason: 'offline' }]);
  });

  it('ignores messages from a socket that was replaced', async () => {
    const { socket, gw, events, live } = await startedPayment();
    socket.close();
    await vi.advanceTimersByTimeAsync(1_000);
    live().open();
    expect(gw.getStatus()).toBe('open');
    socket.serverSends({ type: 'payment_status', paymentId: 'p1', status: 'authorising' });
    expect(events).toEqual([{ type: 'failed', paymentId: 'p1', reason: 'offline' }]);
  });
});

describe('dispense order', () => {
  it('approval alone does not start the delivery', () => {
    const approved = [
      { type: 'REQUEST', request },
      { type: 'STARTED', paymentId: 'p1' },
      {
        type: 'EVENT',
        event: { type: 'approved', paymentId: 'p1', authCode: 'A', method: 'card' },
      },
    ] as const;
    const state = approved.reduce(paymentReducer, initialPaymentState);
    expect(state.status).toBe('approved');
    expect(
      paymentReducer(state, {
        type: 'EVENT',
        event: { type: 'dispense', paymentId: 'p1', productCode: '21' },
      }).status,
    ).toBe('dispensing');
  });
});
