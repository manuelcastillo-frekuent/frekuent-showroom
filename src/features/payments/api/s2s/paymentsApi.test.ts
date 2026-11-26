import { describe, expect, it, vi } from 'vitest';
import { clientCredentialsTokenProvider, type TokenProvider } from './auth';
import type { HttpRequest, HttpResponse, HttpTransport } from './http';
import { createPaymentsApi } from './paymentsApi';
import { ApiError } from './protocol';
import { pollingStatusSource } from './statusSource';

/** Answers each request with the next queued reply and records what was sent. */
function scripted(...replies: (HttpResponse | Error)[]) {
  const sent: HttpRequest[] = [];
  const transport: HttpTransport = {
    async send(request) {
      sent.push(request);
      const next = replies.shift();
      if (!next) throw new Error('no reply queued');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { transport, sent };
}

const staticTokens = () => {
  let n = 0;
  const invalidate = vi.fn<() => void>();
  return { getToken: async () => `t${++n}`, invalidate } satisfies TokenProvider;
};

const charge = { transaction_uuid: 'u1', status: 'pending', status_code: 100 };
const noWait = async () => undefined;

describe('createPaymentsApi', () => {
  it('sends the Bearer token, JSON and the extra headers', async () => {
    const { transport, sent } = scripted({ status: 200, body: charge });
    const api = createPaymentsApi({
      transport,
      tokens: staticTokens(),
      baseUrl: 'https://x/payments/v1/external/',
      headers: { 'ngrok-skip-browser-warning': '1' },
    });
    await api.create({ amount: 150, device_serial: 105640, product_description: '12 Agua' });
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: 'https://x/payments/v1/external/create',
      headers: {
        authorization: 'Bearer t1',
        'content-type': 'application/json',
        'ngrok-skip-browser-warning': '1',
      },
      body: '{"amount":150,"device_serial":105640,"product_description":"12 Agua"}',
    });
  });

  it('asks /pay to wait for the dispense', async () => {
    const { transport, sent } = scripted({
      status: 200,
      body: { ...charge, status: 'in_progress' },
    });
    await createPaymentsApi({ transport, tokens: staticTokens(), baseUrl: 'https://x' }).pay('u1');
    expect(sent[0]).toMatchObject({ url: 'https://x/u1/pay', body: '{"await_dispense":true}' });
  });

  it('renews the token once after a 401·101 and repeats the call', async () => {
    const tokens = staticTokens();
    const { transport, sent } = scripted(
      { status: 401, body: { error_code: 101, error: 'token_expired', message: '' } },
      { status: 204, body: null },
    );
    await createPaymentsApi({ transport, tokens, baseUrl: 'https://x' }).dispense('u1', true);
    expect(tokens.invalidate).toHaveBeenCalledTimes(1);
    expect(sent.map((r) => r.headers.authorization)).toEqual(['Bearer t1', 'Bearer t2']);
  });

  it('gives up after a second 401 instead of looping', async () => {
    const e401 = { status: 401, body: { error_code: 100, error: 'invalid_token', message: '' } };
    const { transport } = scripted(e401, e401);
    const api = createPaymentsApi({ transport, tokens: staticTokens(), baseUrl: 'https://x' });
    await expect(api.dispense('u1', true)).rejects.toMatchObject({
      httpStatus: 401,
      errorCode: 100,
    });
  });

  it('retries a 5xx twice on calls other than /status, and never on /status', async () => {
    const e500 = { status: 502, body: { error_code: 500, error: 'bad_gateway', message: '' } };
    const create = scripted(e500, e500, { status: 200, body: charge });
    const api = createPaymentsApi({
      transport: create.transport,
      tokens: staticTokens(),
      baseUrl: 'https://x',
      sleep: noWait,
    });
    await expect(api.create({ amount: 1, device_serial: 1 })).resolves.toMatchObject({
      transaction_uuid: 'u1',
    });
    expect(create.sent).toHaveLength(3);

    const status = scripted(e500);
    const api2 = createPaymentsApi({
      transport: status.transport,
      tokens: staticTokens(),
      baseUrl: 'https://x',
      sleep: noWait,
    });
    await expect(api2.status('u1')).rejects.toBeInstanceOf(ApiError);
    expect(status.sent).toHaveLength(1);
  });

  it('reads the error code from the error body', async () => {
    const { transport } = scripted({
      status: 409,
      body: { error_code: 402, error: 'device_not_connected', message: 'Spot offline' },
    });
    const api = createPaymentsApi({ transport, tokens: staticTokens(), baseUrl: 'https://x' });
    const error = await api.create({ amount: 1, device_serial: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).is(409, 402)).toBe(true);
  });
});

describe('clientCredentialsTokenProvider', () => {
  const token = (n: number) => ({
    status: 200,
    body: { access_token: `a${n}`, refresh_token: `r${n}`, token_type: 'bearer', expires_in: 100 },
  });

  it('caches the token and renews it with less than 20 % of its life left', async () => {
    let now = 0;
    const { transport, sent } = scripted(token(1), token(2));
    const tokens = clientCredentialsTokenProvider({
      transport,
      authUrl: 'https://a/auth',
      clientCode: 'c',
      clientSecret: 's',
      now: () => now,
    });
    expect(await tokens.getToken()).toBe('a1');
    now = 79_000;
    expect(await tokens.getToken()).toBe('a1');
    now = 81_000;
    expect(await tokens.getToken()).toBe('a2');
    expect(sent.map((r) => r.url)).toEqual([
      'https://a/auth/clients/token',
      'https://a/auth/clients/token/refresh',
    ]);
    expect(JSON.parse(sent[1]!.body!)).toEqual({
      refresh_token: 'r1',
      client_code: 'c',
      client_secret: 's',
    });
  });

  it('asks for a new token when the refresh fails', async () => {
    const { transport, sent } = scripted(
      token(1),
      { status: 401, body: { error_code: 101 } },
      token(2),
    );
    const tokens = clientCredentialsTokenProvider({
      transport,
      authUrl: 'https://a',
      clientCode: 'c',
      clientSecret: 's',
    });
    await tokens.getToken();
    tokens.invalidate();
    expect(await tokens.getToken()).toBe('a2');
    expect(sent.map((r) => r.url)).toEqual([
      'https://a/clients/token',
      'https://a/clients/token/refresh',
      'https://a/clients/token',
    ]);
  });
});

describe('pollingStatusSource', () => {
  it('resolves on a wanted status, rides out errors, and gives up at maxMs', async () => {
    vi.useFakeTimers();
    const statuses: (string | Error)[] = ['in_progress', new TypeError('down'), 'authorized'];
    const api = {
      status: vi.fn(async () => {
        const next = statuses.shift()!;
        if (next instanceof Error) throw next;
        return { transaction_uuid: 'u1', status: next } as never;
      }),
    };
    const source = pollingStatusSource(api as never, { pollMs: 100 });
    const seen: string[] = [];
    const found = source.waitFor('u1', ['authorized'], {
      maxMs: 10_000,
      onStatus: (s) => seen.push(s),
    });
    await vi.advanceTimersByTimeAsync(300);
    await expect(found).resolves.toBe('authorized');
    expect(seen).toEqual(['in_progress', 'authorized']);

    api.status.mockResolvedValue({ transaction_uuid: 'u1', status: 'in_progress' } as never);
    const none = source.waitFor('u1', ['authorized'], { maxMs: 500 });
    await vi.advanceTimersByTimeAsync(700);
    await expect(none).resolves.toBeNull();
    vi.useRealTimers();
  });
});
