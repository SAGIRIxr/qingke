package cn.qingke.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.security.MessageDigest;

/** Pure, testable allowlist for the one official update source and verified APKs. */
final class UpdatePolicy {
    static final String PACKAGE = "cn.qingke.app";
    static final String REPOSITORY = "https://github.com/SAGIRIxr/qingke";
    static final String MANIFEST = REPOSITORY + "/releases/latest/download/update.json";
    static final String DEFAULT_PROXY = "https://ghfast.top/";
    static final int MAX_MANIFEST = 64 * 1024;
    static final long MAX_APK = 128L * 1024 * 1024;

    static String proxy(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        URI uri = https(raw, 500);
        if (uri.getRawQuery() != null || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath())))
            throw new IllegalArgumentException("代理只填写 HTTPS 根地址，不带路径或参数");
        return uri.getScheme() + "://" + uri.getRawAuthority() + "/";
    }
    private static URI https(String raw, int max) {
        try {
            URI uri = new URI(raw);
            if (raw.length() > max || !"https".equals(uri.getScheme()) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getRawFragment() != null || raw.indexOf('\\') >= 0
                    || uri.getPort() == 0 || uri.getPort() > 65535) throw new URISyntaxException(raw, "HTTPS required");
            return uri;
        } catch (URISyntaxException error) { throw new IllegalArgumentException("更新地址必须是有效 HTTPS 地址"); }
    }
    static String asset(String packageName, long code, String name, String tag, String asset, long size, String sha256) {
        if (!PACKAGE.equals(packageName) || code < 1 || code > 2100000000L || name == null || !name.matches("[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}")
                || !("v" + name).equals(tag) || !("qingke-" + name + "-release.apk").equals(asset)
                || size < 1024 || size > MAX_APK || sha256 == null || !sha256.matches("[a-fA-F0-9]{64}"))
            throw new IllegalArgumentException("更新清单中的包名、版本、文件名、大小或摘要无效");
        return REPOSITORY + "/releases/download/" + tag + "/" + asset;
    }
    static String transport(String source, String proxy) { return proxy(proxy) + source; }

    static String redirect(String target, String current, String proxy, String original) {
        String resolved;
        try { resolved = new URI(current).resolve(target).toString(); }
        catch (URISyntaxException error) { throw new IllegalArgumentException("更新重定向地址无效"); }
        URI uri = https(resolved, 8192);
        if (uri.getPort() != -1 && uri.getPort() != 443) {
            if (!sameProxy(uri, proxy)) throw new IllegalArgumentException("更新重定向端口不受支持");
        }
        String candidate = resolved;
        if (sameProxy(uri, proxy)) candidate = resolved.substring(proxy(proxy).length());
        if (candidate.startsWith(REPOSITORY + "/")) {
            URI source = https(candidate, 1000);
            if (source.getRawQuery() == null && (candidate.equals(original) || (original.equals(MANIFEST)
                    && candidate.matches("https://github\\.com/SAGIRIxr/qingke/releases/download/v[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}/update\\.json")))) return resolved;
        }
        // GitHub release assets redirect to a signed URL on these exact GitHub-owned hosts.
        if (("release-assets.githubusercontent.com".equals(uri.getHost()) || "objects.githubusercontent.com".equals(uri.getHost()))
                && uri.getRawPath().startsWith("/github-production-release-asset")) return resolved;
        throw new IllegalArgumentException("更新重定向离开了指定 GitHub 发布来源");
    }
    private static boolean sameProxy(URI uri, String proxy) {
        if (proxy == null || proxy.isEmpty()) return false;
        URI base = URI.create(proxy(proxy));
        return uri.getRawAuthority().equals(base.getRawAuthority()) && uri.toString().startsWith(base.toString());
    }
    static void validateArchive(String packageName, long installedCode, long actualCode, long declaredCode,
                                boolean debuggable, byte[][] installedSigners, byte[][] archiveSigners) {
        if (!PACKAGE.equals(packageName) || actualCode <= installedCode || actualCode != declaredCode || debuggable)
            throw new IllegalArgumentException("安装包不是更高版本的清课正式包");
        if (installedSigners == null || archiveSigners == null || installedSigners.length == 0 || installedSigners.length != archiveSigners.length)
            throw new IllegalArgumentException("无法验证安装包签名");
        boolean[] matched = new boolean[archiveSigners.length];
        for (byte[] installed : installedSigners) {
            if (installed == null || installed.length == 0) throw new IllegalArgumentException("当前应用签名为空");
            boolean found = false;
            for (int i = 0; i < archiveSigners.length; i++) if (!matched[i] && MessageDigest.isEqual(installed, archiveSigners[i])) { matched[i] = true; found = true; break; }
            if (!found) throw new IllegalArgumentException("安装包签名与当前应用不一致，已停止安装");
        }
    }
}
