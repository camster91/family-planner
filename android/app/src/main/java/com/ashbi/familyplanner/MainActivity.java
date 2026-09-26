package com.ashbi.familyplanner;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Follow-up flushes after pause (ms). A device refresh already in flight
     * when the tablet is backgrounded lands its rotated Set-Cookie after the
     * pause-time flush; these persist it before a background process kill.
     */
    static final long[] FOLLOW_UP_FLUSH_DELAYS_MS = {2_000L, 10_000L, 30_000L};

    private final Handler flushHandler = new Handler(Looper.getMainLooper());
    private final Runnable flushCookies = () -> CookieManager.getInstance().flush();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Shared tablet (#242, docs/architecture/SHARED_DEVICE.md): Back on a
        // /device/* page must never land on a person sign-in or dashboard, and
        // at the board it should not close the app. Send the task to the
        // background instead; elsewhere keep the existing system behaviour.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (SharedDeviceNavigation.isDevicePage(currentUrl())) {
                    moveTaskToBack(true);
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @Override
    public void onPause() {
        super.onPause();
        // Device refresh tokens rotate on every refresh. Persist the WebView
        // cookie store now so a process kill after backgrounding does not
        // resurrect an already-rotated cookie (which the server would treat as
        // token reuse once the 60 s grace has passed), and again shortly after
        // in case a refresh response is still in flight.
        flushHandler.removeCallbacks(flushCookies);
        CookieManager.getInstance().flush();
        for (long delay : FOLLOW_UP_FLUSH_DELAYS_MS) {
            flushHandler.postDelayed(flushCookies, delay);
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        CookieManager.getInstance().flush();
    }

    @Override
    public void onResume() {
        super.onResume();
        flushHandler.removeCallbacks(flushCookies);
    }

    private String currentUrl() {
        if (getBridge() == null) return null;
        WebView webView = getBridge().getWebView();
        return webView != null ? webView.getUrl() : null;
    }
}
