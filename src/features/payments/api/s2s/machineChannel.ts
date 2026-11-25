import { parseServerMessage, type ClientMessage, type ServerMessage } from './protocol';

/** The slice of the browser WebSocket we use, so tests can pass a fake. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export type ConnectionStatus = 'connecting' | 'open' | 'down';

export type DispenseOrder = ServerMessage;

export interface ConnectionOptions {
  /** A socket that has not opened by then is abandoned and retried. */
  connectTimeoutMs?: number;
  /** First retry delay; doubles on each failed attempt up to `retryMaxMs`. */
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface PaymentWatch {
  onOrder: (order: DispenseOrder) => void;
  /** The channel dropped while this payment was waiting on it. */
  onDrop: () => void;
}

/** What the S2S gateway needs from the channel; tests pass a fake. */
export interface MachineLink {
  whenOpen(): Promise<void>;
  watch(paymentId: string, watch: PaymentWatch): void;
  forget(paymentId: string): void;
  sendResult(paymentId: string, success: boolean): void;
}

const OPEN = 1;
/** Orders for payments this screen does not know; the channel may broadcast. */
const EARLY_LIMIT = 20;

/**
 * Machine channel: the persistent link over which the server sends the
 * dispense order and the screen answers with the dispense result. WebSocket
 * today; it may become MQTT, which is why it is kept apart from the HTTP calls.
 *
 * The connection is opened at startup and kept alive by retrying with
 * exponential backoff, so a dead server shows up before a visitor pays. A drop
 * still fails whatever is waiting for an order: there is no way yet to resume
 * after reconnecting.
 */
export class MachineChannel implements MachineLink {
  private socket: SocketLike | null = null;
  private status: ConnectionStatus = 'down';
  private started = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private statusListeners = new Set<() => void>();
  private watches = new Map<string, PaymentWatch>();
  /** Orders that beat `watch`; replayed when it is registered. */
  private early: DispenseOrder[] = [];
  private readonly connectTimeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(
    private readonly url: string,
    private readonly createSocket: (url: string) => SocketLike = (u) => new WebSocket(u),
    options: ConnectionOptions = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    this.retryMaxMs = options.retryMaxMs ?? 30_000;
  }

  /** Starts keeping the connection open. Safe to call more than once. */
  connect() {
    if (this.started) return;
    this.started = true;
    this.open();
  }

  getStatus = () => this.status;

  subscribeStatus = (notify: () => void) => {
    this.statusListeners.add(notify);
    return () => {
      this.statusListeners.delete(notify);
    };
  };

  /**
   * Resolves once the channel is open. While a connection attempt is under way
   * it waits for its outcome, bounded by the connect timeout; when the server
   * is known to be down it fails at once so the visitor is not left waiting.
   */
  whenOpen(): Promise<void> {
    this.connect();
    if (this.status === 'open') return Promise.resolve();
    if (this.status === 'down') return Promise.reject(this.offlineError());
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribeStatus(() => {
        if (this.status === 'connecting') return;
        unsubscribe();
        if (this.status === 'open') resolve();
        else reject(this.offlineError());
      });
    });
  }

  watch(paymentId: string, watch: PaymentWatch) {
    this.watches.set(paymentId, watch);
    const early = this.early.filter((o) => o.paymentId === paymentId);
    this.early = this.early.filter((o) => o.paymentId !== paymentId);
    // After the caller has stored the paymentId, so the reducer accepts them.
    if (early.length) queueMicrotask(() => early.forEach(watch.onOrder));
  }

  forget(paymentId: string) {
    this.watches.delete(paymentId);
  }

  sendResult(paymentId: string, success: boolean) {
    this.sendIfOpen({ type: 'dispense_result', paymentId, success });
  }

  private open() {
    clearTimeout(this.retryTimer);
    const socket = this.createSocket(this.url);
    this.socket = socket;
    this.setStatus('connecting');

    // Some networks swallow the handshake without ever closing the socket.
    const connectTimer = setTimeout(() => {
      if (this.socket !== socket || this.status !== 'connecting') return;
      socket.close();
      this.dropped(socket);
    }, this.connectTimeoutMs);

    socket.addEventListener('open', () => {
      clearTimeout(connectTimer);
      if (this.socket !== socket) return;
      this.attempts = 0;
      this.setStatus('open');
    });
    socket.addEventListener('close', () => {
      clearTimeout(connectTimer);
      this.dropped(socket);
    });
    socket.addEventListener('message', (event) => {
      if (this.socket === socket) this.receive(event.data);
    });
  }

  /** Handles a socket that closed or never opened; stale sockets are ignored. */
  private dropped(socket: SocketLike) {
    if (this.socket !== socket) return;
    this.socket = null;
    const watches = [...this.watches.values()];
    this.watches.clear();
    this.early = [];
    this.setStatus('down');
    watches.forEach((w) => w.onDrop());
    this.scheduleRetry();
  }

  private scheduleRetry() {
    const ceiling = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** this.attempts);
    this.attempts += 1;
    // Jitter keeps several totems from hammering a restarted server in sync.
    const delay = Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((notify) => notify());
  }

  private offlineError() {
    return new Error(`Machine channel offline: ${this.url}`);
  }

  private receive(raw: unknown) {
    let order: DispenseOrder;
    try {
      order = parseServerMessage(raw);
    } catch (error) {
      console.warn('[showroom] ignored channel message', raw, error);
      return;
    }
    const watch = this.watches.get(order.paymentId);
    if (watch) watch.onOrder(order);
    else this.early = [...this.early, order].slice(-EARLY_LIMIT);
  }

  private sendIfOpen(message: ClientMessage) {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
    else console.warn('[showroom] not sent, channel is not open', message);
  }
}
