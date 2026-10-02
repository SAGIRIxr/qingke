package cn.qingke.app;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Arrays;

public final class ShareRequestPolicyTest {
    private static int checks;
    interface Attempt { void run() throws Exception; }
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    private static void rejects(Attempt attempt, String label) {
        checks++;
        try { attempt.run(); } catch (IllegalArgumentException | IOException expected) { return; }
        catch (Exception error) { throw new AssertionError(label, error); }
        throw new AssertionError(label);
    }
    public static void main(String[] args) throws Exception {
        String code = "0123456789abcdefghij";
        check(ShareRequestPolicy.origin("https://EXAMPLE.com/").equals("https://example.com"), "Canonical HTTPS root");
        check(ShareRequestPolicy.endpoint("https://example.com:8443", "create", "").equals("https://example.com:8443/api/shares"), "Fixed create path with custom TLS port");
        check(ShareRequestPolicy.endpoint("https://example.com", "get", code).equals("https://example.com/api/shares/" + code), "Fixed get path");
        check(ShareRequestPolicy.method("delete").equals("DELETE"), "Delete method is fixed");
        check(ShareRequestPolicy.method("update").equals("PUT"), "Authenticated update method is fixed");
        check(ShareRequestPolicy.endpoint("https://example.com", "update", code).equals("https://example.com/api/shares/" + code), "Update uses only fixed share-code path");
        rejects(() -> ShareRequestPolicy.endpoint("https://example.com", "update", "bad/code"), "Update cannot inject an arbitrary endpoint");
        rejects(() -> ShareRequestPolicy.origin("http://example.com"), "Plain HTTP denied");
        rejects(() -> ShareRequestPolicy.origin("https://user:pass@example.com"), "URL credentials denied");
        rejects(() -> ShareRequestPolicy.origin("https://example.com/path"), "Custom path denied");
        rejects(() -> ShareRequestPolicy.origin("https://example.com/%2f"), "Encoded path denied");
        rejects(() -> ShareRequestPolicy.origin("https://example.com?token=secret"), "Query denied");
        rejects(() -> ShareRequestPolicy.origin("https://example.com#x"), "Fragment denied");
        rejects(() -> ShareRequestPolicy.origin("https://example.com:0"), "Invalid zero port denied");
        rejects(() -> ShareRequestPolicy.origin("https://example.com:65536"), "Oversized port denied");
        rejects(() -> ShareRequestPolicy.origin("https://qingke.local"), "Local app origin denied");
        rejects(() -> ShareRequestPolicy.origin("https://example.com\r\nX-Test: yes"), "CRLF injection denied");
        rejects(() -> ShareRequestPolicy.endpoint("https://example.com", "get", "../../etc/passwd"), "Code traversal denied");
        rejects(() -> ShareRequestPolicy.endpoint("https://example.com", "get", code + "a"), "Non-20-char code denied");
        rejects(() -> ShareRequestPolicy.endpoint("https://example.com", "fetch", code), "Generic fetch action denied");
        rejects(() -> ShareRequestPolicy.bearer("secret\r\nCookie:secret"), "Header injection denied");
        check(ShareRequestPolicy.bearer("0123456789abcdef_-").equals("Bearer 0123456789abcdef_-"), "Deletion bearer token accepted");
        check(ShareRequestPolicy.requestBytes("课表").length == 6, "Request counts UTF-8 bytes");
        rejects(() -> ShareRequestPolicy.requestBytes("课".repeat(400_000)), "Multibyte request size enforced");
        check(ShareRequestPolicy.readBounded(new ByteArrayInputStream(new byte[ShareRequestPolicy.MAX_RESPONSE_BYTES])).length == ShareRequestPolicy.MAX_RESPONSE_BYTES, "Exact response limit accepted");
        rejects(() -> ShareRequestPolicy.readBounded(new ByteArrayInputStream(new byte[ShareRequestPolicy.MAX_RESPONSE_BYTES + 1])), "Oversized stream rejected even without content length");
        check(Arrays.equals(ShareRequestPolicy.readBounded(new ByteArrayInputStream(new byte[]{1,2,3})), new byte[]{1,2,3}), "Response bytes preserved");
        System.out.println("PASS: " + checks + " sharing boundary checks");
    }
}
