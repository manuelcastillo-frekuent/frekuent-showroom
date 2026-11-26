package com.frekuent.showroom;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

import java.io.IOException;
import java.io.InputStream;

/**
 * Kiosk shell: a full-screen WebView and nothing else. All behaviour lives in the web.
 *
 * <p>The bundled web is served from an https origin instead of file:// because Chromium
 * refuses ES module scripts from file:// and Vite emits only modules.
 */
public class MainActivity extends Activity {

    static final String ASSET_HOST = "appassets.androidplatform.net";

    /** How long a failed start page waits before trying again. */
    static final long RETRY_MS = 5_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private ShowroomNative bridge;
    private final Runnable retryLoad = () -> webView.loadUrl(startUrl());

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF000000);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        // No text-selection or copy menu when a visitor holds a finger on the screen.
        webView.setOnLongClickListener(v -> true);
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // The bundled page is https; a ws:// test BFF would otherwise be blocked as mixed content.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebViewClient(new KioskClient());
        // Payments API token and requests for the page, without handing it the secret.
        bridge = new ShowroomNative(webView, handler, this::startUrl);
        webView.addJavascriptInterface(bridge, "ShowroomNative");
        setContentView(webView);

        if (Build.VERSION.SDK_INT >= 33) {
            // Swallow Back: there is nowhere for a visitor to go back to.
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> { });
        }

        webView.loadUrl(startUrl());
    }

    /** `adb shell am start -n com.frekuent.showroom/.MainActivity -e url '…'` overrides the build URL. */
    private String startUrl() {
        String override = getIntent().getStringExtra("url");
        return override != null && !override.isEmpty() ? override : BuildConfig.START_URL;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller == null) return;
            controller.hide(WindowInsets.Type.systemBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Pre-Android 13 counterpart of the OnBackInvokedCallback above.
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(retryLoad);
        bridge.shutdown();
        webView.destroy();
        super.onDestroy();
    }

    private class KioskClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!ASSET_HOST.equals(uri.getHost())) return null;
            String path = uri.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            try {
                InputStream stream = getAssets().open(path.substring(1));
                return new WebResourceResponse(mimeType(path), null, stream);
            } catch (IOException missing) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            // The online APK can boot before the venue Wi-Fi is up: keep the screen black
            // instead of Chromium's error page and keep trying until the web loads.
            view.loadUrl("about:blank");
            handler.removeCallbacks(retryLoad);
            handler.postDelayed(retryLoad, RETRY_MS);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // A crashed or OOM-killed renderer leaves a dead WebView; start over instead of
            // leaving the totem frozen in front of visitors.
            recreate();
            return true;
        }
    }

    static String mimeType(String path) {
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
        switch (ext) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "ttf": return "font/ttf";
            case "otf": return "font/otf";
            case "mp4": return "video/mp4";
            case "webm": return "video/webm";
            case "ico": return "image/x-icon";
            default: return "application/octet-stream";
        }
    }
}
