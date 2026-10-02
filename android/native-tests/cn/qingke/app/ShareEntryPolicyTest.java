package cn.qingke.app;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public final class ShareEntryPolicyTest {
    private static int checks;
    private static final String CODE = "0123456789ABCDEFGHJK";
    private static final String SECOND = "1123456789ABCDEFGHJK";
    private static final String ROOT = "https://qk.sagiri.org";
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    private static String encoded(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    private static String link(String code, String server) { return ROOT + "/s#code=" + code + "&server=" + encoded(server); }
    private static void reject(String url, String label) { check(ShareEntryPolicy.parse(url) == null, label); }

    public static void main(String[] args) {
        String url = link(CODE, ROOT);
        ShareEntryPolicy.Link parsed = ShareEntryPolicy.parse(url);
        check(parsed != null && CODE.equals(parsed.code) && ROOT.equals(parsed.server), "Fixed HTTPS app link parses");
        check(parsed.id.matches("[0-9a-f]{64}"), "Only a SHA256 identifier is exposed for deduplication");
        ShareEntryPolicy.Link custom = ShareEntryPolicy.parse("qingke://share?server=" + encoded(ROOT) + "&code=" + CODE);
        check(custom != null && parsed.id.equals(custom.id), "Custom scheme and reversed parameters identify the same share");
        ShareEntryPolicy.Link grouped = ShareEntryPolicy.parse(link("01234-56789-abcde-fghjk", "https://QK.SAGIRI.ORG/"));
        check(grouped != null && grouped.id.equals(parsed.id), "Grouped lowercase code and canonical root deduplicate");
        check(ShareEntryPolicy.parse(parsed.url()).id.equals(parsed.id), "Saved pending links round trip through full validation");
        check(ShareEntryPolicy.parse(link(CODE, "https://example.org:8443/")).server.equals("https://example.org:8443"), "User-selected HTTPS root and TLS port survive");
        check(ShareEntryPolicy.fromIntent("android.intent.action.VIEW", url) != null, "Only explicit view action recognized");
        check(ShareEntryPolicy.fromIntent("android.intent.action.SEND", url) == null, "SEND action cannot trigger entry");
        check(ShareEntryPolicy.fromIntent(null, url) == null, "Missing action is ignored");
        reject("http://qk.sagiri.org/s#code=" + CODE + "&server=" + encoded(ROOT), "Plain HTTP app link denied");
        reject(url.replace("qk.sagiri.org/s", "qk.sagiri.org.evil/s"), "Lookalike host denied");
        reject(url.replace("qk.sagiri.org/s", "user@qk.sagiri.org/s"), "App-link credentials denied");
        reject(url.replace("qk.sagiri.org/s", "qk.sagiri.org:443/s"), "External authority must exactly match declared protocol");
        reject(url.replace("/s#", "/s/#"), "Trailing route path denied");
        reject(url.replace("/s#", "/%73#"), "Encoded route denied");
        reject(url.replace("/s#", "/s?operation=import#"), "App-link query denied");
        reject(url + "&action=delete", "Unknown operation cannot enter the app");
        reject(url + "&deleteToken=example", "Management tokens not accepted as link parameters");
        reject(url + "&code=" + SECOND, "Duplicate code denied");
        reject(ROOT + "/s#server=" + encoded(ROOT) + "&server=" + encoded(ROOT), "Missing code and duplicate server denied");
        reject(url.replace("code=", "%63ode="), "Encoded parameter name denied");
        reject(ROOT + "/s#code=" + CODE, "Server is required, no silent default server mutation");
        reject(link(CODE, "http://example.org"), "Server must be HTTPS");
        reject(link(CODE, "https://user:pass@example.org"), "Server credentials denied");
        reject(link(CODE, ROOT + "/api"), "Server path denied");
        reject(link(CODE, ROOT + "?operation=delete"), "Server query denied");
        reject(link(CODE, ROOT + "#secret"), "Server fragment denied");
        reject(link(CODE, "https://qingke.local"), "Private application resource origin denied");
        reject(link(CODE, ROOT + "\r\nX-Test: a"), "Encoded control characters denied");
        reject(link(CODE, "https://" + "a".repeat(501) + ".org"), "Server length is bounded");
        reject(url.replace(CODE, "0123456789ABCDEFGHJI"), "Non-Crockford character denied");
        reject(url.replace(CODE, CODE + "0"), "Long code denied");
        reject(url.replace(CODE, "%25" + CODE), "Double-encoded data not decoded twice");
        reject(url.replace(CODE, "%C0%AF" + CODE), "Malformed UTF8 denied instead of replacement decoding");
        reject(url.replace(CODE, CODE + "+"), "Plus not mistaken for ignored whitespace");
        reject(url + "&", "Empty trailing parameter denied");
        reject(url + "#another", "Second fragment delimiter denied");
        reject("qingke://share/?code=" + CODE + "&server=" + encoded(ROOT), "Custom path denied");
        reject("qingke://delete?code=" + CODE + "&server=" + encoded(ROOT), "Custom action host denied");
        reject("qingke://share?code=" + CODE + "&server=" + encoded(ROOT) + "#x", "Custom fragment denied");
        reject("https://qingke.local/index.html#code=" + CODE + "&server=" + encoded(ROOT), "Cannot route links into local WebView");
        reject("javascript:alert(1)", "Script URI denied");
        reject(url + "a".repeat(2048), "Whole link length bounded");

        check(ShareEntryPolicy.fromClipboard("清课课程表\n口令：01234-56789-ABCDE-FGHJK\n" + url + "\n打开清课后确认导入").id.equals(parsed.id), "Full generated message recognized by its strict link only");
        check(ShareEntryPolicy.fromClipboard("链接：「" + url + "」").id.equals(parsed.id), "Common Chinese wrappers do not alter the URL");
        check(ShareEntryPolicy.fromClipboard("qingke://share?code=" + CODE + "&server=" + encoded(ROOT)).id.equals(parsed.id), "Custom scheme recognized as copied plain text");
        check(ShareEntryPolicy.fromClipboard(url + "\n" + parsed.url()).id.equals(parsed.id), "Identical repeated links are not ambiguous");
        check(ShareEntryPolicy.fromClipboard(url + "\n" + link(SECOND, ROOT)) == null, "Two different shares require manual choice");
        check(ShareEntryPolicy.fromClipboard("不是分享内容：用户名 密码") == null, "Other clipboard text not forwarded");
        check(ShareEntryPolicy.fromClipboard("https://evil.test/?url=" + url) == null, "Nested third-party redirect value not extracted as a share");
        check(ShareEntryPolicy.fromClipboard(url + "&action=delete") == null, "Clipboard extra operation denied as a whole URL");
        check(ShareEntryPolicy.fromClipboard("a".repeat(ShareEntryPolicy.MAX_TEXT_CHARS) + "\n" + url) == null, "Oversized clipboard skipped before scanning");
        check(ShareEntryPolicy.validText("清课分享\n" + url), "Text sharing accepts generated message");
        check(!ShareEntryPolicy.validText(" ") && !ShareEntryPolicy.validText(null), "Empty share text rejected");
        check(!ShareEntryPolicy.validText("a".repeat(ShareEntryPolicy.MAX_TEXT_CHARS + 1)), "Share and copy text bounded");
        check(!ShareEntryPolicy.validText("code\u0000value"), "Binary control text rejected");

        ShareEntryInbox inbox = new ShareEntryInbox();
        check(inbox.offer(parsed, "clipboard"), "First recognized clipboard queued");
        check(!inbox.offer(custom, "clipboard"), "Equivalent pending clipboard not duplicated");
        ShareEntryPolicy.Link second = ShareEntryPolicy.parse(link(SECOND, ROOT));
        check(inbox.offer(second, "link") && inbox.poll().link.id.equals(second.id), "Explicit incoming link precedes old clipboard suggestion");
        check(inbox.poll().link.id.equals(parsed.id) && inbox.poll() == null, "Consumption is destructive and ordered");
        check(!inbox.offer(parsed, "clipboard"), "Rejected or consumed clipboard will not prompt again");
        ShareEntryInbox recreated = new ShareEntryInbox();
        recreated.restoreRecent(inbox.recentState());
        check(!recreated.offer(parsed, "clipboard"), "Recognized fingerprint persists across Activity/process restoration");
        check(recreated.offer(parsed, "link") && recreated.hasExplicit(), "An explicit tap remains usable and blocks old clipboard scanning after declining a suggestion");
        check(recreated.poll().source.equals("link"), "Source is supplied by native, not URL parameters");
        ShareEntryInbox promotion = new ShareEntryInbox();
        promotion.offer(parsed, "clipboard");
        check(promotion.offer(parsed, "link") && promotion.snapshot().length == 1 && promotion.poll().source.equals("link"), "Explicit same-share link upgrades pending clipboard without duplicate");
        ShareEntryInbox saved = new ShareEntryInbox();
        saved.restoreRecent(inbox.recentState());
        saved.restorePending(new String[]{url}, new String[]{"clipboard"}, true);
        check(saved.poll().link.id.equals(parsed.id), "Saved unconsumed clipboard survives recreation despite recent fingerprint");
        check(saved.snapshot().length == 0, "Consumed snapshot does not replay a confirmation");
        saved.restorePending(new String[]{url}, new String[]{"clipboard"}, false);
        check(!saved.hasPending(), "Disabling clipboard suppresses restored suggestions");
        saved.restorePending(new String[]{"https://evil.test"}, new String[]{"link"}, true);
        check(!saved.hasPending(), "Saved state is revalidated before handoff");
        saved.restorePending(new String[]{url}, new String[]{"delete"}, true);
        check(!saved.hasPending(), "Restored source whitelist enforced");
        saved.restorePending(new String[]{url}, new String[]{"clipboard"}, true);
        saved.dropClipboard();
        check(!saved.hasPending(), "Turning clipboard off drops pending native suggestions");
        ShareEntryInbox bounded = new ShareEntryInbox();
        for (int i = 0; i < 8; i++) bounded.offer(ShareEntryPolicy.parse(link(i + CODE.substring(1), ROOT)), "link");
        check(bounded.snapshot().length == 8, "Pending queue bounded to eight");
        check(!bounded.offer(ShareEntryPolicy.parse(link("8" + CODE.substring(1), ROOT)), "clipboard"), "Clipboard cannot displace explicit incoming links");
        check(bounded.offer(ShareEntryPolicy.parse(link("9" + CODE.substring(1), ROOT)), "link") && bounded.snapshot().length == 8, "Explicit link accepted with bounded eviction");
        check(bounded.poll().link.code.equals(CODE), "Queue overflow preserves the earliest awaiting explicit choice");
        ShareEntryInbox ownCopy = new ShareEntryInbox();
        ownCopy.remember(parsed);
        check(!ownCopy.offer(parsed, "clipboard"), "Sharing or copying our own message does not self-import");
        ownCopy.restoreRecent("untrusted text is not a hash");
        check(ownCopy.recentState().isEmpty(), "Recent storage never retains arbitrary clipboard text");
        System.out.println("PASS: " + checks + " share entry and clipboard checks");
    }
}
