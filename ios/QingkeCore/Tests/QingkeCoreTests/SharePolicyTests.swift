import XCTest
@testable import QingkeCore

/// Mirrors ShareEntryPolicyTest / ShareRequestPolicyTest on Android.
final class SharePolicyTests: XCTestCase {
    private let code = "0123456789ABCDEFGHJK"
    private let second = "1123456789ABCDEFGHJK"
    private let root = "https://qk.sagiri.org"

    private func encoded(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.*"))!
    }
    private func link(_ code: String, _ server: String) -> String { "\(root)/s#code=\(code)&server=\(encoded(server))" }

    func testAcceptedLinks() throws {
        let url = link(code, root)
        let parsed = try XCTUnwrap(ShareEntryPolicy.parse(url))
        XCTAssertEqual(parsed.code, code)
        XCTAssertEqual(parsed.server, root)
        XCTAssertNotNil(parsed.id.range(of: "^[0-9a-f]{64}$", options: .regularExpression))
        let custom = try XCTUnwrap(ShareEntryPolicy.parse("qingke://share?server=\(encoded(root))&code=\(code)"))
        XCTAssertEqual(custom.id, parsed.id)
        XCTAssertEqual(ShareEntryPolicy.parse(link("01234-56789-abcde-fghjk", "https://QK.SAGIRI.ORG/"))?.id, parsed.id)
        XCTAssertEqual(ShareEntryPolicy.parse(parsed.url)?.id, parsed.id)
        XCTAssertEqual(ShareEntryPolicy.parse(link(code, "https://example.org:8443/"))?.server, "https://example.org:8443")
    }

    func testRejectedLinks() {
        let url = link(code, root)
        let rejected: [String] = [
            "http://qk.sagiri.org/s#code=\(code)&server=\(encoded(root))",
            url.replacingOccurrences(of: "qk.sagiri.org/s", with: "qk.sagiri.org.evil/s"),
            url.replacingOccurrences(of: "qk.sagiri.org/s", with: "user@qk.sagiri.org/s"),
            url.replacingOccurrences(of: "qk.sagiri.org/s", with: "qk.sagiri.org:443/s"),
            url.replacingOccurrences(of: "/s#", with: "/s/#"),
            url.replacingOccurrences(of: "/s#", with: "/%73#"),
            url.replacingOccurrences(of: "/s#", with: "/s?operation=import#"),
            url + "&action=delete",
            url + "&code=\(second)",
            "\(root)/s#server=\(encoded(root))&server=\(encoded(root))",
            url.replacingOccurrences(of: "code=", with: "%63ode="),
            "\(root)/s#code=\(code)",
            link(code, "http://example.org"),
            link(code, "https://user:pass@example.org"),
            link(code, root + "/api"),
            link(code, root + "?operation=delete"),
            link(code, root + "#secret"),
            link(code, "https://qingke.local"),
            link(code, root + "\r\nX-Test: a"),
            link(code, "https://" + String(repeating: "a", count: 501) + ".org"),
            url.replacingOccurrences(of: code, with: "0123456789ABCDEFGHJI"),
            url.replacingOccurrences(of: code, with: code + "0"),
            url.replacingOccurrences(of: code, with: "%25" + code),
            url.replacingOccurrences(of: code, with: "%C0%AF" + code),
            url.replacingOccurrences(of: code, with: code + "+"),
            url + "&",
            url + "#another",
            "qingke://share/?code=\(code)&server=\(encoded(root))",
            "qingke://delete?code=\(code)&server=\(encoded(root))",
            "qingke://share?code=\(code)&server=\(encoded(root))#x",
            "https://qingke.local/index.html#code=\(code)&server=\(encoded(root))",
            "javascript:alert(1)",
            url + String(repeating: "a", count: 2048),
        ]
        for (index, candidate) in rejected.enumerated() {
            XCTAssertNil(ShareEntryPolicy.parse(candidate), "case \(index): \(candidate)")
        }
    }

    func testClipboard() throws {
        let url = link(code, root)
        let parsed = try XCTUnwrap(ShareEntryPolicy.parse(url))
        XCTAssertEqual(ShareEntryPolicy.fromClipboard("清课课程表\n口令：01234-56789-ABCDE-FGHJK\n\(url)\n打开清课后确认导入")?.id, parsed.id)
        XCTAssertEqual(ShareEntryPolicy.fromClipboard("链接：「\(url)」")?.id, parsed.id)
        XCTAssertEqual(ShareEntryPolicy.fromClipboard("qingke://share?code=\(code)&server=\(encoded(root))")?.id, parsed.id)
        XCTAssertEqual(ShareEntryPolicy.fromClipboard("\(url)\n\(parsed.url)")?.id, parsed.id)
        XCTAssertNil(ShareEntryPolicy.fromClipboard("\(url)\n\(link(second, root))"))
        XCTAssertNil(ShareEntryPolicy.fromClipboard("不是分享内容：用户名 密码"))
        XCTAssertNil(ShareEntryPolicy.fromClipboard("https://evil.test/?url=\(url)"))
        XCTAssertNil(ShareEntryPolicy.fromClipboard(url + "&action=delete"))
        XCTAssertNil(ShareEntryPolicy.fromClipboard(String(repeating: "a", count: ShareEntryPolicy.maxTextCharacters) + "\n" + url))
        XCTAssertTrue(ShareEntryPolicy.validText("清课分享\n" + url))
        XCTAssertFalse(ShareEntryPolicy.validText(" "))
        XCTAssertFalse(ShareEntryPolicy.validText(nil))
        XCTAssertFalse(ShareEntryPolicy.validText("code\u{0}value"))
    }

    func testInbox() throws {
        let parsed = try XCTUnwrap(ShareEntryPolicy.parse(link(code, root)))
        let custom = try XCTUnwrap(ShareEntryPolicy.parse("qingke://share?code=\(code)&server=\(encoded(root))"))
        let other = try XCTUnwrap(ShareEntryPolicy.parse(link(second, root)))
        let inbox = ShareEntryInbox()
        XCTAssertTrue(inbox.offer(parsed, source: "clipboard"))
        XCTAssertFalse(inbox.offer(custom, source: "clipboard"))
        XCTAssertTrue(inbox.offer(other, source: "link"))
        XCTAssertEqual(inbox.poll()?.link.id, other.id)
        XCTAssertEqual(inbox.poll()?.link.id, parsed.id)
        XCTAssertNil(inbox.poll())
        XCTAssertFalse(inbox.offer(parsed, source: "clipboard"))
        let recreated = ShareEntryInbox()
        recreated.restoreRecent(inbox.recentState)
        XCTAssertFalse(recreated.offer(parsed, source: "clipboard"))
        XCTAssertTrue(recreated.offer(parsed, source: "link"))
        XCTAssertTrue(recreated.hasExplicit)
        let bounded = ShareEntryInbox()
        for index in 0..<8 { bounded.offer(ShareEntryPolicy.parse(link("\(index)" + code.dropFirst(), root)), source: "link") }
        XCTAssertFalse(bounded.offer(ShareEntryPolicy.parse(link("8" + code.dropFirst(), root)), source: "clipboard"))
        XCTAssertTrue(bounded.offer(ShareEntryPolicy.parse(link("9" + code.dropFirst(), root)), source: "link"))
        XCTAssertEqual(bounded.poll()?.link.code, code)
        let own = ShareEntryInbox()
        own.remember(parsed)
        XCTAssertFalse(own.offer(parsed, source: "clipboard"))
        own.restoreRecent("untrusted text is not a hash")
        XCTAssertEqual(own.recentState, "")
    }

    func testRequestPolicy() throws {
        let shareCode = "0123456789abcdefghij"
        XCTAssertEqual(try ShareRequestPolicy.origin("https://EXAMPLE.com/"), "https://example.com")
        XCTAssertEqual(try ShareRequestPolicy.endpoint(baseURL: "https://example.com:8443", action: "create", code: ""), "https://example.com:8443/api/shares")
        XCTAssertEqual(try ShareRequestPolicy.endpoint(baseURL: "https://example.com", action: "update", code: shareCode), "https://example.com/api/shares/\(shareCode)")
        for bad in ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/%2f",
                    "https://example.com?token=secret", "https://example.com#x", "https://example.com:0", "https://example.com:65536",
                    "https://qingke.local", "https://example.com\r\nX-Test: yes"] {
            XCTAssertThrowsError(try ShareRequestPolicy.origin(bad), bad)
        }
        XCTAssertThrowsError(try ShareRequestPolicy.endpoint(baseURL: "https://example.com", action: "get", code: "../../etc/passwd"))
        XCTAssertThrowsError(try ShareRequestPolicy.endpoint(baseURL: "https://example.com", action: "fetch", code: shareCode))
        XCTAssertThrowsError(try ShareRequestPolicy.bearer("secret\r\nCookie:secret"))
        XCTAssertEqual(try ShareRequestPolicy.bearer("0123456789abcdef_-"), "Bearer 0123456789abcdef_-")
        XCTAssertEqual(try ShareRequestPolicy.requestBytes("课表").count, 6)
        XCTAssertThrowsError(try ShareRequestPolicy.requestBytes(String(repeating: "课", count: 400_000)))
    }

    func testEnvelopeIsRebuilt() throws {
        let payload = #"{"format":"qingke-semester","version":1,"semester":{"id":"s"},"includeNotes":false,"expiresInDays":30,"code":"x","deleteToken":"secret-token-123456","extra":"leak"}"#
        let request = try ShareRequestPolicy.request(action: "create", baseURL: "https://example.com", payloadJSON: payload)
        XCTAssertEqual(request.method, "POST")
        XCTAssertNil(request.authorization)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.body)) as? [String: Any])
        XCTAssertEqual(Set(body.keys), ["format", "version", "semester", "includeNotes", "includeExams", "allowFollow", "expiresInDays"])
        XCTAssertThrowsError(try ShareRequestPolicy.request(action: "create", baseURL: "https://example.com",
                                                            payloadJSON: payload.replacingOccurrences(of: #""includeNotes":false"#, with: #""includeNotes":0"#)))
        let update = #"{"format":"qingke-semester","version":1,"semester":{},"includeNotes":true,"expectedRevision":3,"code":"0123456789abcdefghij","deleteToken":"0123456789abcdef_-"}"#
        let put = try ShareRequestPolicy.request(action: "update", baseURL: "https://example.com", payloadJSON: update)
        XCTAssertEqual(put.method, "PUT")
        XCTAssertEqual(put.authorization, "Bearer 0123456789abcdef_-")
        let get = try ShareRequestPolicy.request(action: "get", baseURL: "https://example.com", payloadJSON: #"{"code":"0123456789abcdefghij"}"#)
        XCTAssertNil(get.body)
    }
}
