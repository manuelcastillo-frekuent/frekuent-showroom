import type { TokenProvider } from './auth';
import type { HttpTransport } from './http';
import {
  ApiError,
  ERR,
  parseCharge,
  parseList,
  toApiError,
  type CancelReason,
  type ChargeReply,
  type CreateBody,
  type ListReply,
  type StatusReply,
} from './protocol';

/** HTTP calls to the Payments API; tests pass a fake. */
export interface PaymentsApi {
  create(body: CreateBody): Promise<ChargeReply>;
  pay(uuid: string): Promise<ChargeReply>;
  status(uuid: string): Promise<StatusReply>;
  /** 204 on success; errors carry the `error_code` the caller decides on. */
  dispense(uuid: string, success: boolean): Promise<void>;
  cancel(uuid: string, reason: CancelReason): Promise<ChargeReply>;
  list(query: { dateFrom: string; deviceSerial: number; limit?: number }): Promise<ListReply>;
}

export interface PaymentsApiOptions {
  transport: HttpTransport;
  tokens: TokenProvider;
  baseUrl: string;
  /** Sent on every request, e.g. `ngrok-skip-browser-warning` in the test environment. */
  headers?: Record<string, string>;
  /** Waits before retrying a 5xx on anything but /status (1 s and 3 s, brief §10). */
  serverErrorRetriesMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createPaymentsApi(options: PaymentsApiOptions): PaymentsApi {
  const { transport, tokens } = options;
  const base = options.baseUrl.replace(/\/$/, '');
  const retries = options.serverErrorRetriesMs ?? [1_000, 3_000];
  const sleep = options.sleep ?? defaultSleep;
  const charge = (uuid: string) => `/${encodeURIComponent(uuid)}`;

  async function once(method: 'GET' | 'POST', path: string, body?: object, renewed = false) {
    const token = await tokens.getToken();
    const reply = await transport.send({
      method,
      url: `${base}${path}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...options.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (reply.status >= 200 && reply.status < 300) return reply.body;
    const error = toApiError(reply.status, reply.body);
    // An expired or rejected token is renewed once, and the call repeated.
    if (
      !renewed &&
      error.httpStatus === 401 &&
      (error.errorCode === ERR.tokenInvalid || error.errorCode === ERR.tokenExpired)
    ) {
      tokens.invalidate();
      return once(method, path, body, true);
    }
    throw error;
  }

  /** `/status` is retried by the polling itself; everything else retries its 5xx here. */
  async function call(method: 'GET' | 'POST', path: string, body?: object, retry5xx = true) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(method, path, body);
      } catch (error) {
        const is5xx = error instanceof ApiError && error.httpStatus >= 500;
        if (!retry5xx || !is5xx || attempt >= retries.length) throw error;
        await sleep(retries[attempt]!);
      }
    }
  }

  return {
    async create(body) {
      return parseCharge(await call('POST', '/create', body));
    },
    async pay(uuid) {
      return parseCharge(await call('POST', `${charge(uuid)}/pay`, { await_dispense: true }));
    },
    async status(uuid) {
      return parseCharge(
        await call('GET', `${charge(uuid)}/status`, undefined, false),
      ) as StatusReply;
    },
    async dispense(uuid, success) {
      await call('POST', `${charge(uuid)}/dispense`, { success });
    },
    async cancel(uuid, reason) {
      return parseCharge(await call('POST', `${charge(uuid)}/cancel`, { reason }));
    },
    async list({ dateFrom, deviceSerial, limit = 20 }) {
      const q = new URLSearchParams({
        date_from: dateFrom,
        device_serial: String(deviceSerial),
        limit: String(limit),
      });
      return parseList(await call('GET', `/list?${q}`));
    },
  };
}
