package com.ashbi.familyplanner;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * Locates and parses checked-in (and Gradle/Capacitor generated) Android project files from JVM
 * unit tests. Gradle runs unit tests with the module directory (android/app) as the working
 * directory; build.gradle also passes it explicitly as the {@code familyplanner.appDir} system
 * property so IDE runs with a different working directory still resolve the same files.
 */
final class ProjectFiles {

    static final String ANDROID_NS = "http://schemas.android.com/apk/res/android";

    private ProjectFiles() {}

    /** The android/app module directory. */
    static File appDir() {
        String configured = System.getProperty("familyplanner.appDir");
        File dir = configured != null && !configured.isEmpty() ? new File(configured) : new File("").getAbsoluteFile();
        if (!new File(dir, "src/main/AndroidManifest.xml").isFile() && new File(dir, "app/src/main/AndroidManifest.xml").isFile()) {
            dir = new File(dir, "app");
        }
        assertTrue("Cannot locate android/app module from " + dir, new File(dir, "src/main/AndroidManifest.xml").isFile());
        return dir;
    }

    /** The repository root (parent of android/). */
    static File repoRoot() {
        return appDir().getParentFile().getParentFile();
    }

    static File mainFile(String relative) {
        return new File(appDir(), "src/main/" + relative);
    }

    /**
     * Merged manifests produced by the Android Gradle Plugin for any variant built so far
     * (processDebugResources runs before unit tests compile, so the debug one exists under Gradle).
     */
    static List<File> mergedManifests() {
        List<File> found = new ArrayList<>();
        File intermediates = new File(appDir(), "build/intermediates");
        File[] dirs = intermediates.listFiles((d, name) -> name.startsWith("merged_manifest"));
        if (dirs != null) {
            for (File dir : dirs) {
                collect(dir, found);
            }
        }
        return found;
    }

    private static void collect(File dir, List<File> out) {
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.isDirectory()) {
                collect(child, out);
            } else if (child.getName().equals("AndroidManifest.xml")) {
                out.add(child);
            }
        }
    }

    static String read(File file) {
        try {
            return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new AssertionError("Cannot read " + file, e);
        }
    }

    static Document parseXml(File file) {
        assertTrue("Missing XML file " + file, file.isFile());
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            DocumentBuilder builder = factory.newDocumentBuilder();
            return builder.parse(file);
        } catch (Exception e) {
            throw new AssertionError("Cannot parse XML " + file, e);
        }
    }

    /** Resolves an {@code @xml/name} manifest reference to src/main/res/xml/name.xml. */
    static File xmlResource(String reference) {
        if (reference == null || !reference.startsWith("@xml/")) {
            fail("Expected an @xml/ resource reference but found: " + reference);
        }
        return mainFile("res/xml/" + reference.substring("@xml/".length()) + ".xml");
    }

    static String androidAttr(Element element, String name) {
        return element.hasAttributeNS(ANDROID_NS, name) ? element.getAttributeNS(ANDROID_NS, name) : null;
    }

    static List<Element> childElements(Node parent) {
        List<Element> result = new ArrayList<>();
        NodeList nodes = parent.getChildNodes();
        for (int i = 0; i < nodes.getLength(); i++) {
            if (nodes.item(i) instanceof Element) {
                result.add((Element) nodes.item(i));
            }
        }
        return result;
    }

    static List<Element> childElements(Node parent, String tag) {
        List<Element> result = new ArrayList<>();
        for (Element child : childElements(parent)) {
            if (child.getTagName().equals(tag)) result.add(child);
        }
        return result;
    }
}
