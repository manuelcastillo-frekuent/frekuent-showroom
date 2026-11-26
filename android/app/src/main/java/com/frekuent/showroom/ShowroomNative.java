package com.frekuent.showroom;

import android.net.Uri;
import android.os.Handler;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

/**
 * The page's way into the Payments API without holding its secrets (brief QIM-488 §4).
 *
 * <p>The client credentials live here, in the APK's local configuration, never in the
 * web's JavaScript: the page only ever receives the access token. Requests can also go
 * through here, where the API's missing CORS does not apply.
 *
 * <p>JavaScript calls {@code ShowroomNative.call(id, method, argsJson)}; the answer comes
 * back later through {@code window.__showroomNative.settle(id, ok, payloadJson)}.
 * Only the page this APK opened may call it.
 */
final class ShowroomNative {

    private static final String TAG = "ShowroomNative";
    private static final int TIMEOUT_MS = 15_000;

    private final WebView webView;
    private final Handler main;
    private final Supplier<String> allowedPage;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    // Token cache, touched only from the io thread.
    private String accessToken;
    private String refreshToken;
    private long issuedAt;
    private long expiresAt;

    ShowroomNative(WebView webView, Handler main, Supplier<String> allowedPage) {
        this.webView = webView;
        this.main = main;
        this.allowedPage = allowedPage;
    }

    @JavascriptInterface
    public void call(String id, String method, String argsJson) {
        // Which page is asking can only be read on the UI thread.
        main.post(() -> {
            if (!sameOrigin(webView.getUrl(), allowedPage.get())) {
                Log.w(TAG, "Refused " + method + " from " + webView.getUrl());
                settle(id, false, JSONObject.quote("forbidden_origin"));
                return;
            }
            io.execute(() -> {
                try {
                    JSONObject args = new JSONObject(argsJson == null ? "{}" : argsJson);
                    String result;
                    switch (method) {
                        case "getAccessToken":
                            result = new JSONObject()
                                    .put("access_token", token(args.optBoolean("forceRefresh")))
                                    .toString();
                            break;
                        case "request":
                            result = request(args);
                            break;
                        default:
                            throw new IllegalArgumentException("unknown_method");
                    }
                    settle(id, true, result);
                } catch (Exception e) {
                    Log.w(TAG, method + " failed", e);
                    settle(id, false, JSONObject.quote(String.valueOf(e.getMessage())));
                }
            });
        });
    }

    void shutdown() {
        io.shutdownNow();
    }

    private void settle(String id, boolean ok, String payloadJson) {
        String js = "window.__showroomNative&&window.__showroomNative.settle("
                + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(payloadJson) + ")";
        main.post(() -> webView.evaluateJavascript(js, null));
    }

    // ---- Token -------------------------------------------------------------------------

    /** Cached token, renewed with less than 20 % of its life left (refresh first, then new). */
    private String token(boolean forceRefresh) throws IOException, JSONException {
        if (BuildConfig.CLIENT_SECRET.isEmpty() || BuildConfig.AUTH_URL.isEmpty())
            throw new IOException("credentials_not_configured");
        long now = System.currentTimeMillis();
        if (!forceRefresh && accessToken != null
                && now < expiresAt - (long) ((expiresAt - issuedAt) * 0.2)) {
            return accessToken;
        }
        if (refreshToken != null) {
            try {
                JSONObject body = new JSONObject()
                        .put("refresh_token", refreshToken)
                        .put("client_code", BuildConfig.CLIENT_CODE)
                        .put("client_secret", BuildConfig.CLIENT_SECRET);
                return store(postAuth("/clients/token/refresh", body));
            } catch (IOException | JSONException refreshFailed) {
                Log.i(TAG, "Token refresh failed, asking for a new one");
            }
        }
        JSONObject body = new JSONObject()
                .put("client_code", BuildConfig.CLIENT_CODE)
                .put("client_secret", BuildConfig.CLIENT_SECRET);
        return store(postAuth("/clients/token", body));
    }

    private String store(JSONObject token) throws JSONException {
        accessToken = token.getString("access_token");
        refreshToken = token.optString("refresh_token", null);
        issuedAt = System.currentTimeMillis();
        expiresAt = issuedAt + token.getLong("expires_in") * 1000L;
        return accessToken;
    }

    private JSONObject postAuth(String path, JSONObject body) throws IOException, JSONException {
        String url = BuildConfig.AUTH_URL.replaceAll("/$", "") + path;
        Reply reply = send("POST", url, new JSONObject().put("content-type", "application/json"),
                body.toString());
        if (reply.status != 200) throw new IOException("auth " + reply.status);
        return new JSONObject(reply.body);
    }

    // ---- Requests ----------------------------------------------------------------------

    /** A Payments API request from the page; any other destination is refused. */
    private String request(JSONObject args) throws IOException, JSONException {
        String url = args.getString("url");
        String base = BuildConfig.PAYMENTS_URL.replaceAll("/$", "");
        if (base.isEmpty() || !(url.equals(base) || url.startsWith(base + "/") || url.startsWith(base + "?")))
            throw new IOException("url_not_allowed");
        Reply reply = send(args.getString("method"), url, args.optJSONObject("headers"),
                args.has("body") && !args.isNull("body") ? args.getString("body") : null);
        return new JSONObject().put("status", reply.status).put("body", reply.body).toString();
    }

    private static final class Reply {
        final int status;
        final String body;

        Reply(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    private Reply send(String method, String url, JSONObject headers, String body) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setRequestMethod(method);
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            if (headers != null) {
                for (Iterator<String> keys = headers.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    conn.setRequestProperty(key, headers.optString(key));
                }
            }
            // The test environment runs behind ngrok, which wants this or shows a warning page.
            if (url.contains("ngrok")) conn.setRequestProperty("ngrok-skip-browser-warning", "1");
            if (body != null) {
                conn.setDoOutput(true);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            return new Reply(status, read(in));
        } finally {
            conn.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream stream = in) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = stream.read(chunk)) != -1) buffer.write(chunk, 0, n);
            return buffer.toString(StandardCharsets.UTF_8.name());
        }
    }

    static boolean sameOrigin(String a, String b) {
        if (a == null || b == null) return false;
        Uri x = Uri.parse(a);
        Uri y = Uri.parse(b);
        return x.getScheme() != null && x.getScheme().equals(y.getScheme())
                && x.getHost() != null && x.getHost().equals(y.getHost())
                && x.getPort() == y.getPort();
    }
}
