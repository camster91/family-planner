package com.ashbi.familyplanner;

import java.net.URI;
import java.net.URISyntaxException;

/** Pure URL rules for the shared-tablet shell, kept Android-free so JVM tests cover them. */
final class SharedDeviceNavigation {

    private SharedDeviceNavigation() {}

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
