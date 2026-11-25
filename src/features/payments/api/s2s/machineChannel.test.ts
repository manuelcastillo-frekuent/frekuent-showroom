import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MachineChannel,
  type ConnectionOptions,
  type DispenseOrder,
  type SocketLike,
} from './machineChannel';

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

const order = (paymentId = 'p1'): DispenseOrder => ({
  type: 'dispense',
  paymentId,
  productCode: '21',
  authCode: 'AB12',
  method: 'card',
});

const flush = () => vi.advanceTimersByTimeAsync(0);

/** A channel whose sockets the test drives; `live()` is the current one. */
function setup(options: ConnectionOptions = {}) {
  const sockets: FakeSocket[] = [];
  const channel = new MachineChannel(
    'ws://test',
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    { connectTimeoutMs: 5_000, retryBaseMs: 1_000, retryMaxMs: 8_000, ...options },
  );
  return { channel, sockets, live: () => sockets.at(-1)! };
}

function connected() {
  const ctx = setup();
  ctx.channel.connect();
  ctx.live().open();
  return ctx;
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

describe('MachineChannel (orders)', () => {
  it('hands the dispense order to the payment that watches it', () => {
    const { channel, live } = connected();
    const onOrder = vi.fn();
    channel.watch('p1', { onOrder, onDrop: vi.fn() });
    live().serverSends(order());
    expect(onOrder).toHaveBeenCalledWith(order());
  });

  it('replays an order that arrived before the payment was watched', async () => {
    const { channel, live } = connected();
    live().serverSends(order());
    const onOrder = vi.fn();
    channel.watch('p1', { onOrder, onDrop: vi.fn() });
    expect(onOrder).not.toHaveBeenCalled();
    await flush();
    expect(onOrder).toHaveBeenCalledOnce();
  });

  it('sends the dispense result', () => {
    const { channel, live } = connected();
    channel.sendResult('p1', false);
    expect(live().sent).toEqual([{ type: 'dispense_result', paymentId: 'p1', success: false }]);
  });

  it('ignores messages that do not match the protocol', () => {
    const { channel, live } = connected();
    const onOrder = vi.fn();
    channel.watch('p1', { onOrder, onDrop: vi.fn() });
    live().serverSends({ ...order(), method: 'cash' });
    live().serverSends({ type: 'payment_approved', paymentId: 'p1' });
    expect(onOrder).not.toHaveBeenCalled();
  });

  it('tells watched payments when the channel drops', () => {
    const { channel, live } = connected();
    const onDrop = vi.fn();
    channel.watch('p1', { onOrder: vi.fn(), onDrop });
    live().close();
    expect(onDrop).toHaveBeenCalledOnce();
  });

  it('ignores messages from a socket that was replaced', async () => {
    const { channel, live } = connected();
    const old = live();
    old.close();
    await vi.advanceTimersByTimeAsync(1_000);
    live().open();
    const onOrder = vi.fn();
    channel.watch('p1', { onOrder, onDrop: vi.fn() });
    old.serverSends(order());
    expect(onOrder).not.toHaveBeenCalled();
  });
});

describe('MachineChannel (connection)', () => {
  it('opens the socket on connect, before any sale', () => {
    const { channel, sockets } = setup();
    expect(sockets).toHaveLength(0);
    channel.connect();
    channel.connect();
    expect(sockets).toHaveLength(1);
    expect(channel.getStatus()).toBe('connecting');
    sockets[0]!.open();
    expect(channel.getStatus()).toBe('open');
  });

  it('lets a sale made while connecting wait for the socket to open', async () => {
    const { channel, live } = setup();
    channel.connect();
    const open = channel.whenOpen();
    live().open();
    await expect(open).resolves.toBeUndefined();
  });

  it('fails at once while the server is down', async () => {
    const { channel, live } = setup();
    channel.connect();
    live().close();
    expect(channel.getStatus()).toBe('down');
    await expect(channel.whenOpen()).rejects.toThrow('offline');
  });

  it('reconnects with a doubling delay and resets it once connected', async () => {
    const { channel, sockets, live } = setup();
    channel.connect();

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
    expect(channel.getStatus()).toBe('open');
    live().close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(4);
  });

  it('caps the retry delay', async () => {
    // Long handshake timeout so only the retry delays drive this test.
    const { channel, sockets, live } = setup({ connectTimeoutMs: 60_000 });
    channel.connect();
    for (let i = 0; i < 6; i++) {
      live().close();
      await vi.advanceTimersByTimeAsync(8_000);
    }
    expect(sockets).toHaveLength(7);
  });

  it('abandons a handshake that never finishes and retries', async () => {
    const { channel, sockets } = setup();
    channel.connect();
    const rejected = expect(channel.whenOpen()).rejects.toThrow('offline');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets[0]!.readyState).toBe(3);
    expect(channel.getStatus()).toBe('down');
    await rejected;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
  });

  it('notifies status subscribers on every change', () => {
    const { channel, live } = setup();
    const seen: string[] = [];
    channel.subscribeStatus(() => seen.push(channel.getStatus()));
    channel.connect();
    live().open();
    live().close();
    expect(seen).toEqual(['connecting', 'open', 'down']);
  });
});
