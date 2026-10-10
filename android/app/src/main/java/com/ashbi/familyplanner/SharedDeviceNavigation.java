package com.ashbi.familyplanner;

import java.net.URI;
import java.net.URISyntaxException;

/** Pure URL rules for the shared-tablet shell, kept Android-free so JVM tests cover them. */
final class SharedDeviceNavigation {

    private SharedDeviceNavigation() {}

    /** Bundled recovery has no session and must not expose old pages via Back. */
    static boolean isRecoveryPage(String url) {
        if (url == null) return false;
        try {
            URI parsed = new URI(url);
            return "localhost".equals(parsed.getHost())
                && ("https".equals(parsed.getScheme()) || "http".equals(parsed.getScheme()))
                && parsed.getUserInfo() == null
                && "/native-offline.html".equals(parsed.getPath());
        } catch (URISyntaxException e) {
            return false;
        }
    }

    /** True for the tablet's own pages: {@code /device} and anything under {@code /device/}. */
    static boolean isDevicePage(String url) {
        if (url == null || url.isEmpty()) return false;
        String path;
        try {
            path = new URI(url).getPath();
        } catch (URISyntaxException e) {
            return false;
        }
        if (path == null) return false;
        return path.equals("/device") || path.startsWith("/device/");
    }
}
