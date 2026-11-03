package com.ashbi.familyplanner;

import static com.ashbi.familyplanner.ProjectFiles.androidAttr;
import static com.ashbi.familyplanner.ProjectFiles.childElements;
import static org.junit.Assert.*;
import java.io.File;
import java.util.*;
import org.junit.Test;
import org.w3c.dom.Element;

/** Source and merged manifests must not capture login, API or unrelated hosts. */
public class NotificationLinkManifestTest {
    private void checkManifest(File file) {
        Element app = childElements(ProjectFiles.parseXml(file).getDocumentElement(), "application").get(0);
        Set<String> hosts = new HashSet<>();
        int count = 0;
        for (Element activity : childElements(app, "activity")) {
            for (Element filter : childElements(activity, "intent-filter")) {
                boolean view = childElements(filter, "action").stream().anyMatch(e -> "android.intent.action.VIEW".equals(androidAttr(e, "name")));
                if (!view) continue;
                count++;
                assertTrue(androidAttr(activity, "name").endsWith("MainActivity"));
                assertEquals("true", androidAttr(filter, "autoVerify"));
                Set<String> categories = new HashSet<>(), paths = new HashSet<>(), prefixes = new HashSet<>();
                for (Element category : childElements(filter, "category")) categories.add(androidAttr(category, "name"));
                assertEquals(new HashSet<>(Arrays.asList("android.intent.category.DEFAULT", "android.intent.category.BROWSABLE")), categories);
                int authorities = 0;
                for (Element data : childElements(filter, "data")) {
                    if (data.hasAttributeNS("http://schemas.android.com/apk/res/android", "host")) {
                        authorities++;
                        assertEquals("https", androidAttr(data, "scheme"));
                        hosts.add(androidAttr(data, "host"));
                    } else assertNull(androidAttr(data, "scheme"));
                    assertNull(androidAttr(data, "port"));
                    assertNull(androidAttr(data, "pathPattern"));
                    if (androidAttr(data, "path") != null) paths.add(androidAttr(data, "path"));
                    if (androidAttr(data, "pathPrefix") != null) prefixes.add(androidAttr(data, "pathPrefix"));
                }
                assertEquals(1, authorities);
                assertEquals(new HashSet<>(Arrays.asList("/dashboard/today", "/dashboard/calendar", "/dashboard/chores", "/dashboard/rewards")), paths);
                assertEquals(new HashSet<>(Arrays.asList("/dashboard/lists/", "/dashboard/meals/recipes/")), prefixes);
            }
        }
        assertEquals(2, count);
        assertEquals(new HashSet<>(Arrays.asList("herewoven.com", "family.ashbi.ca")), hosts);
    }
    @Test public void sourceIngressIsScoped() { checkManifest(ProjectFiles.mainFile("AndroidManifest.xml")); }
    @Test public void mergedIngressRemainsScoped() {
        for (File file : ProjectFiles.mergedManifests()) checkManifest(file);
    }
}
