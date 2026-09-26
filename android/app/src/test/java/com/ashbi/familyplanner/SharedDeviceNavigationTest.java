package com.ashbi.familyplanner;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;

public class SharedDeviceNavigationTest {

    @Test
    public void devicePagesAreRecognised() {
        assertTrue(SharedDeviceNavigation.isDevicePage("https://family.ashbi.ca/device"));
        assertTrue(SharedDeviceNavigation.isDevicePage("https://family.ashbi.ca/device/today"));
        assertTrue(SharedDeviceNavigation.isDevicePage("https://family.ashbi.ca/device/pair?x=1#top"));
        assertTrue(SharedDeviceNavigation.isDevicePage("https://family.ashbi.ca/device/removed"));
    }

    @Test
    public void otherPagesAreNot() {
        assertFalse(SharedDeviceNavigation.isDevicePage(null));
        assertFalse(SharedDeviceNavigation.isDevicePage(""));
        assertFalse(SharedDeviceNavigation.isDevicePage("https://family.ashbi.ca/"));
        assertFalse(SharedDeviceNavigation.isDevicePage("https://family.ashbi.ca/dashboard"));
        assertFalse(SharedDeviceNavigation.isDevicePage("https://family.ashbi.ca/login"));
        assertFalse(SharedDeviceNavigation.isDevicePage("https://family.ashbi.ca/devices"));
        assertFalse(SharedDeviceNavigation.isDevicePage("https://family.ashbi.ca/dashboard/settings/devices"));
        assertFalse(SharedDeviceNavigation.isDevicePage("not a url with spaces"));
    }

    @Test
    public void mainActivityFlushesCookiesOnPauseAndHandlesBack() throws IOException {
        String source = new String(
            Files.readAllBytes(ProjectFiles.appDir().toPath().resolve("src/main/java/com/ashbi/familyplanner/MainActivity.java")),
            StandardCharsets.UTF_8
        );
        assertTrue("onPause must flush the WebView cookie store", source.contains("CookieManager.getInstance().flush()"));
        assertTrue("Back on /device/* must background the task", source.contains("moveTaskToBack(true)"));
        assertTrue("a refresh landing after pause must be flushed too", source.contains("postDelayed(flushCookies"));
        assertTrue("follow-up flushes must cover at least 30 s", MainActivity.FOLLOW_UP_FLUSH_DELAYS_MS[MainActivity.FOLLOW_UP_FLUSH_DELAYS_MS.length - 1] >= 30_000L);
    }
}
