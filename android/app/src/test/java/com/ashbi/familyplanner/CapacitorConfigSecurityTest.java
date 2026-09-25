package com.ashbi.familyplanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

/**
 * The Android shell loads the production web app remotely. It must only ever do that over HTTPS
 * and must never opt back into cleartext. Checks both the TypeScript source of truth and the JSON
 * Capacitor generates into app assets during `npx cap sync android` (what actually ships).
 */
public class CapacitorConfigSecurityTest {

    private static final String APP_ID = "com.ashbi.familyplanner";

    @Test
    public void sourceConfigUsesHttpsAndNoCleartext() {
        File source = new File(ProjectFiles.repoRoot(), "capacitor.config.ts");
        assertTrue("Missing " + source, source.isFile());
        String ts = stripComments(ProjectFiles.read(source));

        assertFalse("capacitor.config.ts must not enable cleartext", Pattern.compile("cleartext\\s*:\\s*true").matcher(ts).find());
        assertFalse("capacitor.config.ts must not allow mixed content",
            Pattern.compile("allowMixedContent\\s*:\\s*true").matcher(ts).find());
        assertTrue("appId", ts.contains("appId: '" + APP_ID + "'") || ts.contains("appId: \"" + APP_ID + "\""));

        Matcher url = Pattern.compile("\\burl\\s*:\\s*['\"`]([^'\"`]*)['\"`]").matcher(ts);
        int urls = 0;
        while (url.find()) {
            urls++;
            assertHttpsUrl(url.group(1));
        }
        assertEquals("Expected exactly one server url in capacitor.config.ts", 1, urls);
    }

    @Test
    @SuppressWarnings("unchecked")
    public void generatedConfigUsesHttpsAndNoCleartext() {
        File generated = ProjectFiles.mainFile("assets/capacitor.config.json");
        assertTrue("Missing " + generated + " - run `npx cap sync android` before building/testing", generated.isFile());
        Map<String, Object> config = (Map<String, Object>) new MiniJson(ProjectFiles.read(generated)).parse();

        assertEquals(APP_ID, config.get("appId"));
        Map<String, Object> server = (Map<String, Object>) config.get("server");
        assertNotNull("server block missing from generated config", server);
        assertNotEquals("server.cleartext must not be true", Boolean.TRUE, server.get("cleartext"));
        assertHttpsUrl((String) server.get("url"));

        Object allowNavigation = server.get("allowNavigation");
        if (allowNavigation != null) {
            for (Object host : (List<Object>) allowNavigation) {
                assertFalse("allowNavigation must not wildcard every host: " + host, "*".equals(host));
            }
        }
        Map<String, Object> android = (Map<String, Object>) config.get("android");
        if (android != null) {
            assertNotEquals("android.allowMixedContent must not be true", Boolean.TRUE, android.get("allowMixedContent"));
        }
    }

    private static void assertHttpsUrl(String value) {
        assertNotNull("server.url must be set", value);
        URI uri = URI.create(value);
        assertEquals("server.url must use https: " + value, "https", uri.getScheme());
        assertNotNull("server.url must have a host: " + value, uri.getHost());
        assertFalse("server.url must not point at a local/dev host: " + value,
            uri.getHost().equals("localhost") || uri.getHost().startsWith("127.") || uri.getHost().startsWith("10.")
                || uri.getHost().startsWith("192.168."));
    }

    private static String stripComments(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)^\\s*//.*$", "");
    }

    /** Minimal JSON reader (objects, arrays, strings, numbers, literals) to avoid a test dependency. */
    static final class MiniJson {
        private final String s;
        private int i;

        MiniJson(String s) {
            this.s = s;
        }

        Object parse() {
            Object value = value();
            ws();
            if (i != s.length()) throw error("trailing content");
            return value;
        }

        private Object value() {
            ws();
            if (i >= s.length()) throw error("unexpected end");
            char c = s.charAt(i);
            if (c == '{') return object();
            if (c == '[') return array();
            if (c == '"') return string();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return null; }
            int start = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            if (start == i) throw error("unexpected character '" + c + "'");
            return Double.parseDouble(s.substring(start, i));
        }

        private Map<String, Object> object() {
            Map<String, Object> map = new LinkedHashMap<>();
            i++;
            ws();
            if (peek('}')) { i++; return map; }
            while (true) {
                ws();
                String key = string();
                ws();
                expect(':');
                map.put(key, value());
                ws();
                if (peek(',')) { i++; continue; }
                expect('}');
                return map;
            }
        }

        private List<Object> array() {
            List<Object> list = new ArrayList<>();
            i++;
            ws();
            if (peek(']')) { i++; return list; }
            while (true) {
                list.add(value());
                ws();
                if (peek(',')) { i++; continue; }
                expect(']');
                return list;
            }
        }

        private String string() {
            expect('"');
            StringBuilder out = new StringBuilder();
            while (i < s.length()) {
                char c = s.charAt(i++);
                if (c == '"') return out.toString();
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n': out.append('\n'); break;
                        case 't': out.append('\t'); break;
                        case 'r': out.append('\r'); break;
                        case 'b': out.append('\b'); break;
                        case 'f': out.append('\f'); break;
                        case 'u': out.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                        default: out.append(e);
                    }
                } else {
                    out.append(c);
                }
            }
            throw error("unterminated string");
        }

        private void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        }

        private boolean peek(char c) {
            return i < s.length() && s.charAt(i) == c;
        }

        private void expect(char c) {
            if (!peek(c)) throw error("expected '" + c + "'");
            i++;
        }

        private IllegalArgumentException error(String message) {
            return new IllegalArgumentException("Invalid JSON at offset " + i + ": " + message);
        }
    }
}
