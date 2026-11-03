package com.ashbi.familyplanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.security.NetworkSecurityPolicy;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Runs on a device/emulator (`./gradlew connectedDebugAndroidTest`). Confirms the installed app's
 * identity, launcher entry point, and that the runtime honours the manifest hardening.
 */
@RunWith(AndroidJUnit4.class)
public class AppIdentityInstrumentedTest {

    private static final String PACKAGE = "com.ashbi.familyplanner";

    private Context appContext() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    @Test
    public void packageNameIsStableApplicationId() {
        assertEquals(PACKAGE, appContext().getPackageName());
    }

    @Test
    public void launcherIntentResolvesToMainActivity() {
        PackageManager pm = appContext().getPackageManager();
        Intent launch = pm.getLaunchIntentForPackage(PACKAGE);
        assertNotNull("No launcher intent for " + PACKAGE, launch);
        ComponentName component = launch.resolveActivity(pm);
        assertNotNull("Launcher intent does not resolve", component);
        assertEquals(PACKAGE, component.getPackageName());
        assertEquals(MainActivity.class.getName(), component.getClassName());
    }

    @Test
    public void reminderLinksResolveOnlyInsideDeclaredHostsAndPaths() {
        PackageManager pm = appContext().getPackageManager();
        for (String host : new String[]{"herewoven.com", "family.ashbi.ca"}) {
            for (String path : new String[]{"/dashboard/today", "/dashboard/calendar?focus=fixture-event",
                    "/dashboard/chores?focus=fixture-chore", "/dashboard/rewards?focus=fixture-reward",
                    "/dashboard/lists/fixture-list", "/dashboard/meals/recipes/fixture-recipe"}) {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://" + host + path));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setPackage(PACKAGE);
                ComponentName component = intent.resolveActivity(pm);
                assertNotNull("Missing reminder route " + path, component);
                assertEquals(MainActivity.class.getName(), component.getClassName());
            }
        }
        for (String url : new String[]{"https://evil.example/dashboard/today", "http://herewoven.com/dashboard/today",
                "https://herewoven.com/login", "https://herewoven.com/api/events", "https://herewoven.com/device/today"}) {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.setPackage(PACKAGE);
            org.junit.Assert.assertNull("Unexpected app route " + url, intent.resolveActivity(pm));
        }
    }

    @Test
    public void backupAndCleartextAreDisabledAtRuntime() {
        ApplicationInfo info = appContext().getApplicationInfo();
        assertEquals("FLAG_ALLOW_BACKUP must be off", 0, info.flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
        // Instrumentation runs in the app process, so this reflects the app's network security policy.
        assertFalse("Cleartext traffic must not be permitted", NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted());
    }
}
