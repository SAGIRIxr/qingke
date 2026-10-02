package cn.qingke.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** All network destinations and methods are derived here; callers never provide a path/header. */
final class ShareRequestPolicy {
    static final int MAX_REQUEST_BYTES = 1024 * 1024;
    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

    static String origin(String value) {
        if (value == null || value.length() > 500 || value.isEmpty() || value.matches(".*[\\s\\p{Cntrl}].*"))
            throw new IllegalArgumentException("请填写有效的 HTTPS 分享服务器地址");
        try {
            URI uri = new URI(value);
            String path = uri.getRawPath();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getHost().isEmpty()
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (path != null && !path.isEmpty() && !"/".equals(path))
                    || uri.getPort() == 0 || uri.getPort() > 65535 || uri.getPort() < -1
                    || "qingke.local".equalsIgnoreCase(uri.getHost()))
                throw new IllegalArgumentException("服务器地址只允许 HTTPS 主机和端口，不含路径、账号或参数");
            return new URI("https", null, uri.getHost().toLowerCase(Locale.ROOT), uri.getPort(), null, null, null).toASCIIString();
        } catch (URISyntaxException error) { throw new IllegalArgumentException("服务器地址格式不正确"); }
    }

    static String endpoint(String baseUrl, String action, String code) {
        String base = origin(baseUrl);
        if ("create".equals(action)) return base + "/api/shares";
        if (!("get".equals(action) || "delete".equals(action) || "update".equals(action))) throw new IllegalArgumentException("不支持的分享操作");
        if (code == null || !code.matches("[A-Za-z0-9_-]{20}")) throw new IllegalArgumentException("分享码格式不正确，应为 20 位字符");
        return base + "/api/shares/" + code;
    }

    static String method(String action) {
        if ("create".equals(action)) return "POST";
        if ("get".equals(action)) return "GET";
        if ("delete".equals(action)) return "DELETE";
        if ("update".equals(action)) return "PUT";
        throw new IllegalArgumentException("不支持的分享操作");
    }

    static String bearer(String token) {
        if (token == null || !token.matches("[A-Za-z0-9._~+/=-]{16,512}")) throw new IllegalArgumentException("删除凭据无效");
        return "Bearer " + token;
    }

    static byte[] requestBytes(String json) {
        if (json == null || json.length() > MAX_REQUEST_BYTES) throw new IllegalArgumentException("分享内容超过 1 MB");
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_REQUEST_BYTES) throw new IllegalArgumentException("分享内容超过 1 MB");
        return bytes;
    }

    static byte[] readBounded(InputStream stream) throws IOException {
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("请求已取消");
                if (output.size() + count > MAX_RESPONSE_BYTES) throw new IOException("服务器响应超过 2 MB");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }
}
