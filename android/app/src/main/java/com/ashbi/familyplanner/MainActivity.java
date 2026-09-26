package com.ashbi.familyplanner;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

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
        // token reuse once the 60 s grace has passed).
        CookieManager.getInstance().flush();
    }

    private String currentUrl() {
        if (getBridge() == null) return null;
        WebView webView = getBridge().getWebView();
        return webView != null ? webView.getUrl() : null;
    }
}
