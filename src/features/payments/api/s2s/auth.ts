import type { HttpTransport } from './http';
import { callNative } from './nativeBridge';
import { parseToken, toApiError, type TokenResponse } from './protocol';

/** Where the Bearer token comes from. The web never sees the client secret in production. */
export interface TokenProvider {
  getToken(): Promise<string>;
  /** Drops the cached token after a 401, so the next `getToken` renews it. */
  invalidate(): void;
}

/**
 * Production path: the APK holds the client credentials and hands the web only
 * the access token (MainActivity `getAccessToken`), renewing it on its side.
 */
export const nativeTokenProvider = (): TokenProvider => {
  let forceRefresh = false;
  return {
    async getToken() {
      const { access_token } = await callNative<{ access_token: string }>('getAccessToken', {
        forceRefresh,
      });
      forceRefresh = false;
      return access_token;
    },
    invalidate() {
      forceRefresh = true;
    },
  };
};

interface Cached {
  access: string;
  refresh: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Client-credentials flow run in the page itself. Only for local development
 * (`pnpm dev`) and the simulator: it needs the client secret in the page,
 * which a production build must never carry.
 */
export function clientCredentialsTokenProvider(options: {
  transport: HttpTransport;
  authUrl: string;
  clientCode: string;
  clientSecret: string;
  headers?: Record<string, string>;
  now?: () => number;
}): TokenProvider {
  const { transport, clientCode, clientSecret } = options;
  const base = options.authUrl.replace(/\/$/, '');
  const now = options.now ?? Date.now;
  let cached: Cached | null = null;
  let inFlight: Promise<string> | null = null;

  async function post(path: string, body: object): Promise<TokenResponse> {
    const reply = await transport.send({
      method: 'POST',
      url: `${base}${path}`,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
    });
    if (reply.status !== 200) throw toApiError(reply.status, reply.body);
    return parseToken(reply.body);
  }

  const store = (t: TokenResponse) => {
    const issuedAt = now();
    cached = {
      access: t.access_token,
      refresh: t.refresh_token,
      issuedAt,
      expiresAt: issuedAt + t.expires_in * 1000,
    };
    return t.access_token;
  };

  async function renew(): Promise<string> {
    if (cached?.refresh) {
      try {
        return store(
          await post('/clients/token/refresh', {
            refresh_token: cached.refresh,
            client_code: clientCode,
            client_secret: clientSecret,
          }),
        );
      } catch {
        // A failed refresh falls back to asking for a brand-new token.
      }
    }
    return store(
      await post('/clients/token', { client_code: clientCode, client_secret: clientSecret }),
    );
  }

  return {
    getToken() {
      // Renewed with less than 20 % of its life left.
      if (cached && now() < cached.expiresAt - (cached.expiresAt - cached.issuedAt) * 0.2)
        return Promise.resolve(cached.access);
      inFlight ??= renew().finally(() => (inFlight = null));
      return inFlight;
    },
    invalidate() {
      if (cached) cached.expiresAt = 0;
    },
  };
}
