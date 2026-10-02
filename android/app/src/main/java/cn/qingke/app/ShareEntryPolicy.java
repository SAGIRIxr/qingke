package cn.qingke.app;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Pure validation only: external links never become a WebView navigation or a network request. */
final class ShareEntryPolicy {
    static final int MAX_LINK_CHARS = 2048;
    static final int MAX_TEXT_CHARS = 16 * 1024;
    private static final Pattern CANDIDATE = Pattern.compile(
            "(?:^|[\\s(<\\[【「《：])((?:https://qk\\.sagiri\\.org/s#|qingke://share\\?)[^\\s<>\\\"'\\[\\](){}\\u3000-\\u303f\\uff00-\\uffef]+)",
            Pattern.CASE_INSENSITIVE);

    static final class Link {
        final String code, server, id;
        private Link(String code, String server) {
            this.code = code; this.server = server; this.id = fingerprint(code + "\n" + server);
        }
        String url() {
            try { return "https://qk.sagiri.org/s#code=" + code + "&server=" + URLEncoder.encode(server, "UTF-8"); }
            catch (java.io.UnsupportedEncodingException impossible) { throw new AssertionError(impossible); }
        }
    }

    static Link fromIntent(String action, String url) {
        return "android.intent.action.VIEW".equals(action) ? parse(url) : null;
    }

    static Link parse(String url) {
        if (url == null || url.length() > MAX_LINK_CHARS || !url.matches("[\\x21-\\x7E]+")) return null;
        try {
            URI uri = new URI(url);
            if (uri.isOpaque() || uri.getRawUserInfo() != null || uri.getPort() != -1) return null;
            String parameters;
            if ("https".equalsIgnoreCase(uri.getScheme()) && "qk.sagiri.org".equalsIgnoreCase(uri.getHost())
                    && "/s".equals(uri.getRawPath()) && uri.getRawQuery() == null) {
                parameters = uri.getRawFragment();
            } else if ("qingke".equalsIgnoreCase(uri.getScheme()) && "share".equalsIgnoreCase(uri.getHost())
                    && "".equals(uri.getRawPath()) && uri.getRawFragment() == null) {
                parameters = uri.getRawQuery();
            } else return null;
            if (parameters == null) return null;
            String[] parts = parameters.split("&", -1);
            if (parts.length != 2) return null;
            String code = null, server = null;
            for (String part : parts) {
                int equals = part.indexOf('=');
                if (equals < 1) return null;
                String key = part.substring(0, equals), value = decode(part.substring(equals + 1));
                if ("code".equals(key) && code == null) code = normalizeCode(value);
                else if ("server".equals(key) && server == null) server = ShareRequestPolicy.origin(value);
                else return null;
            }
            return code == null || server == null ? null : new Link(code, server);
        } catch (URISyntaxException | IllegalArgumentException error) { return null; }
    }

    static String normalizeCode(String value) {
        if (value == null || value.length() > 39 || !value.matches("[0-9A-HJ-KM-NP-TV-Za-hj-km-np-tv-z]+(?:-[0-9A-HJ-KM-NP-TV-Za-hj-km-np-tv-z]+)*"))
            throw new IllegalArgumentException("分享口令格式不正确");
        String code = value.replace("-", "").toUpperCase(Locale.ROOT);
        if (code.length() != 20) throw new IllegalArgumentException("分享口令应为 20 位字符");
        return code;
    }

    static Link fromClipboard(CharSequence text) {
        if (text == null || text.length() > MAX_TEXT_CHARS || text.length() == 0) return null;
        Matcher matcher = CANDIDATE.matcher(text);
        Link found = null;
        while (matcher.find()) {
            Link candidate = parse(matcher.group(1));
            if (candidate == null) continue;
            // An ambiguous message must be pasted manually; never silently choose another person's share.
            if (found != null && !found.id.equals(candidate.id)) return null;
            found = candidate;
        }
        return found;
    }

    static boolean validText(String text) {
        return text != null && !text.trim().isEmpty() && text.length() <= MAX_TEXT_CHARS
                && !Pattern.compile("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]").matcher(text).find();
    }

    private static String decode(String value) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            if (ch == '%') {
                if (i + 2 >= value.length()) throw new IllegalArgumentException("Invalid escape");
                int high = Character.digit(value.charAt(++i), 16), low = Character.digit(value.charAt(++i), 16);
                if (high < 0 || low < 0) throw new IllegalArgumentException("Invalid escape");
                bytes.write((high << 4) | low);
            } else bytes.write(ch); // '+' is literal, consistent with encodeURIComponent (not form encoding).
        }
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
        } catch (CharacterCodingException error) { throw new IllegalArgumentException("Invalid UTF-8", error); }
    }

    private static String fingerprint(String text) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte value : hash) result.append(String.format(Locale.ROOT, "%02x", value & 255));
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }
}
