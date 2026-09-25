package com.ashbi.familyplanner;

import static com.ashbi.familyplanner.ProjectFiles.androidAttr;
import static com.ashbi.familyplanner.ProjectFiles.childElements;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * Guards the Android shell's backup, transport and file-sharing hardening. These are the
 * properties that keep household session cookies and WebView storage on the device and stop the
 * FileProvider from exposing shared storage. See docs/architecture/ANDROID.md.
 */
public class ManifestSecurityTest {

    private static final String FILE_PROVIDER = "androidx.core.content.FileProvider";
    private static final List<String> BACKUP_DOMAINS = Arrays.asList("root", "file", "database", "sharedpref", "external");

    private static Element application(File manifest) {
        Document doc = ProjectFiles.parseXml(manifest);
        List<Element> apps = childElements(doc.getDocumentElement(), "application");
        assertEquals("Exactly one <application> in " + manifest, 1, apps.size());
        return apps.get(0);
    }

    private static void assertApplicationHardened(File manifest, boolean debugVariant) {
        Element app = application(manifest);
        String where = " in " + manifest;
        assertEquals("android:allowBackup must be false" + where, "false", androidAttr(app, "allowBackup"));
        assertEquals("android:fullBackupContent must be false" + where, "false", androidAttr(app, "fullBackupContent"));
        assertEquals("android:usesCleartextTraffic must be false" + where, "false", androidAttr(app, "usesCleartextTraffic"));
        assertNotNull("android:dataExtractionRules must be set" + where, androidAttr(app, "dataExtractionRules"));
        if (!debugVariant) {
            // AGP injects debuggable="true" only into debug-variant merged manifests.
            assertFalse("android:debuggable must not be set" + where, "true".equals(androidAttr(app, "debuggable")));
        }
        // A custom network security config could re-enable cleartext; require review if one is added.
        assertNull("networkSecurityConfig added; extend this test to assert it denies cleartext" + where,
            androidAttr(app, "networkSecurityConfig"));

        Element provider = fileProvider(app);
        assertEquals("FileProvider must not be exported" + where, "false", androidAttr(provider, "exported"));
    }

    private static Element fileProvider(Element app) {
        Element match = null;
        for (Element provider : childElements(app, "provider")) {
            if (FILE_PROVIDER.equals(androidAttr(provider, "name"))
                && String.valueOf(androidAttr(provider, "authorities")).endsWith(".fileprovider")) {
                assertNull("Only one app FileProvider expected", match);
                match = provider;
            }
        }
        assertNotNull("App FileProvider not declared", match);
        return match;
    }

    @Test
    public void sourceManifestDisablesBackupAndCleartext() {
        assertApplicationHardened(ProjectFiles.mainFile("AndroidManifest.xml"), false);
    }

    @Test
    public void mergedManifestsKeepHardening() {
        // Library manifests can override application attributes during merging; check the result.
        List<File> merged = ProjectFiles.mergedManifests();
        if (merged.isEmpty()) {
            if (System.getProperty("familyplanner.appDir") != null) {
                fail("No merged manifest under app/build/intermediates; Gradle should have produced one before unit tests");
            }
            return; // Running outside Gradle (e.g. plain javac/JUnit): source manifest test still applies.
        }
        for (File manifest : merged) {
            boolean debugVariant = manifest.getPath().contains(File.separator + "debug" + File.separator);
            assertApplicationHardened(manifest, debugVariant);
            assertEquals("Merged package/applicationId", "com.ashbi.familyplanner",
                application(manifest).getOwnerDocument().getDocumentElement().getAttribute("package"));
        }
    }

    @Test
    public void dataExtractionRulesExcludeEverythingFromCloudBackupAndDeviceTransfer() {
        Element app = application(ProjectFiles.mainFile("AndroidManifest.xml"));
        File rulesFile = ProjectFiles.xmlResource(androidAttr(app, "dataExtractionRules"));
        Element root = ProjectFiles.parseXml(rulesFile).getDocumentElement();
        assertEquals("data-extraction-rules", root.getTagName());

        for (String section : Arrays.asList("cloud-backup", "device-transfer")) {
            List<Element> sections = childElements(root, section);
            assertEquals("Exactly one <" + section + "> section", 1, sections.size());
            Element rules = sections.get(0);
            assertTrue("<" + section + "> must not <include> anything", childElements(rules, "include").isEmpty());

            Set<String> excluded = new HashSet<>();
            for (Element exclude : childElements(rules, "exclude")) {
                if (".".equals(exclude.getAttribute("path"))) {
                    excluded.add(exclude.getAttribute("domain"));
                }
            }
            for (String domain : BACKUP_DOMAINS) {
                assertTrue("<" + section + "> must exclude domain=\"" + domain + "\" path=\".\"", excluded.contains(domain));
            }
        }
    }

    @Test
    public void fileProviderOnlySharesAppScopedPicturesAndCache() {
        Element app = application(ProjectFiles.mainFile("AndroidManifest.xml"));
        Element provider = fileProvider(app);
        assertEquals("true", androidAttr(provider, "grantUriPermissions"));

        String pathsRef = null;
        for (Element meta : childElements(provider, "meta-data")) {
            if ("android.support.FILE_PROVIDER_PATHS".equals(androidAttr(meta, "name"))) {
                pathsRef = androidAttr(meta, "resource");
            }
        }
        Element paths = ProjectFiles.parseXml(ProjectFiles.xmlResource(pathsRef)).getDocumentElement();
        assertEquals("paths", paths.getTagName());

        boolean sawPictures = false;
        for (Element entry : childElements(paths)) {
            String tag = entry.getTagName();
            String path = entry.getAttribute("path");
            assertFalse("FileProvider path must not traverse upwards: " + path, path.contains(".."));
            switch (tag) {
                case "external-files-path":
                    assertEquals("external-files-path is limited to the camera Pictures/ dir", "Pictures/", path);
                    sawPictures = true;
                    break;
                case "cache-path":
                    // App-private cache (Capacitor camera/file-chooser temp images); not shared storage.
                    break;
                default:
                    // external-path, root-path, files-path, external-media-path, external-cache-path ...
                    fail("FileProvider must not expose <" + tag + " path=\"" + path + "\">");
            }
        }
        assertTrue("Expected external-files-path Pictures/ for WebView camera capture", sawPictures);
    }

    @Test
    public void launcherActivityIsMainActivity() {
        Element app = application(ProjectFiles.mainFile("AndroidManifest.xml"));
        int launchers = 0;
        for (Element activity : childElements(app, "activity")) {
            for (Element filter : childElements(activity, "intent-filter")) {
                boolean main = false;
                boolean launcher = false;
                for (Element action : childElements(filter, "action")) {
                    main |= "android.intent.action.MAIN".equals(androidAttr(action, "name"));
                }
                for (Element category : childElements(filter, "category")) {
                    launcher |= "android.intent.category.LAUNCHER".equals(androidAttr(category, "name"));
                }
                if (main && launcher) {
                    launchers++;
                    assertEquals(".MainActivity", androidAttr(activity, "name"));
                    assertEquals("singleTask", androidAttr(activity, "launchMode"));
                }
            }
        }
        assertEquals("Exactly one launcher activity", 1, launchers);
    }
}
