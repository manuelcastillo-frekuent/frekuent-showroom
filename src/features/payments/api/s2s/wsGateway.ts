import type { PaymentEvent, PaymentGateway, PaymentRequest } from '../../domain/types';
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

export interface ConnectionOptions {
  /** A socket that has not opened by then is abandoned and retried. */
  connectTimeoutMs?: number;
  /** First retry delay; doubles on each failed attempt up to `retryMaxMs`. */
  retryBaseMs?: number;
  retryMaxMs?: number;
}

const OPEN = 1;

interface PendingSale {
  resolve: (paymentId: string) => void;
  reject: (error: Error) => void;
}

/**
 * Real payments over one persistent WebSocket to the showroom server.
 *
 * The connection is opened at startup and kept alive by retrying with
 * exponential backoff, so a dead server shows up before a visitor pays and the
 * first sale does not wait for a handshake. A drop still fails whatever is in
 * flight: the protocol has no way yet to resume a payment after reconnecting.
 */
export class WsGateway implements PaymentGateway {
  readonly kind = 's2s' as const;
  private socket: SocketLike | null = null;
  private status: ConnectionStatus = 'down';
  private started = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private statusListeners = new Set<() => void>();
  private pendingSales = new Map<string, PendingSale>();
  private listeners = new Map<string, (event: PaymentEvent) => void>();
  /** Events that beat the listener's registration; replayed by `start`. */
  private early: PaymentEvent[] = [];
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

  async start(request: PaymentRequest, onEvent: (event: PaymentEvent) => void) {
    const socket = await this.whenOpen();
    const requestId = crypto.randomUUID();
    const accepted = new Promise<string>((resolve, reject) =>
      this.pendingSales.set(requestId, { resolve, reject }),
    );
    this.send(socket, {
      type: 'sale_request',
      requestId,
      spot: request.spot,
      productCode: request.productCode,
      amountCents: request.amountCents,
    });
    const paymentId = await accepted;
    this.listeners.set(paymentId, onEvent);
    const early = this.early.filter((e) => e.paymentId === paymentId);
    this.early = this.early.filter((e) => e.paymentId !== paymentId);
    // After the caller has stored the paymentId, so the reducer accepts them.
    if (early.length) queueMicrotask(() => early.forEach(onEvent));
    return paymentId;
  }

  async cancel(paymentId: string) {
    // The screen leaves waiting_tap only when the server confirms with
    // payment_failed(cancelled): the visitor may have tapped meanwhile.
    this.sendIfOpen({ type: 'cancel_request', paymentId });
  }

  async confirmDispense(paymentId: string, success: boolean) {
    this.sendIfOpen({ type: 'dispense_result', paymentId, success });
    this.listeners.delete(paymentId);
  }

  /**
   * Resolves with the open socket. While a connection attempt is under way it
   * waits for its outcome, bounded by the connect timeout; when the server is
   * known to be down it fails at once so the visitor is not left waiting.
   */
  private whenOpen(): Promise<SocketLike> {
    this.connect();
    if (this.status === 'open' && this.socket) return Promise.resolve(this.socket);
    if (this.status === 'down') return Promise.reject(this.offlineError());
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribeStatus(() => {
        if (this.status === 'connecting') return;
        unsubscribe();
        if (this.status === 'open' && this.socket) resolve(this.socket);
        else reject(this.offlineError());
      });
    });
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
    this.failInFlight();
    this.setStatus('down');
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

  private failInFlight() {
    const error = this.offlineError();
    this.pendingSales.forEach((sale) => sale.reject(error));
    this.pendingSales.clear();
    this.listeners.forEach((listener, paymentId) =>
      listener({ type: 'failed', paymentId, reason: 'offline' }),
    );
    this.listeners.clear();
    this.early = [];
  }

  private offlineError() {
    return new Error(`WebSocket offline: ${this.url}`);
  }

  private receive(raw: unknown) {
    let parsed: ServerMessage;
    try {
      parsed = parseServerMessage(raw);
    } catch (error) {
      console.warn('[showroom] ignored server message', raw, error);
      return;
    }

    if (parsed.type === 'sale_accepted' || parsed.type === 'sale_rejected') {
      const sale = this.pendingSales.get(parsed.requestId);
      this.pendingSales.delete(parsed.requestId);
      if (parsed.type === 'sale_accepted') sale?.resolve(parsed.paymentId);
      else sale?.reject(new Error(`Sale rejected: ${parsed.reason}`));
      return;
    }

    const event = toEvent(parsed);
    const listener = this.listeners.get(parsed.paymentId);
    if (event.type === 'failed') this.listeners.delete(parsed.paymentId);
    if (listener) listener(event);
    else this.early.push(event);
  }

  private sendIfOpen(message: ClientMessage) {
    if (this.socket?.readyState === OPEN) this.send(this.socket, message);
    else console.warn('[showroom] not sent, socket is not open', message);
  }

  private send(socket: SocketLike, message: ClientMessage) {
    socket.send(JSON.stringify(message));
  }
}

function toEvent(
  message: Exclude<ServerMessage, { type: 'sale_accepted' | 'sale_rejected' }>,
): PaymentEvent {
  switch (message.type) {
    case 'payment_status':
      return { type: message.status, paymentId: message.paymentId };
    case 'payment_approved':
      return {
        type: 'approved',
        paymentId: message.paymentId,
        authCode: message.authCode,
        method: message.method,
      };
    case 'payment_failed':
      return { type: 'failed', paymentId: message.paymentId, reason: message.reason };
    case 'dispense':
      return { type: 'dispense', paymentId: message.paymentId, productCode: message.productCode };
  }
}
