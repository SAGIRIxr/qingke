import CryptoKit
import Foundation

public struct SharePolicyError: Error, LocalizedError, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// All network destinations and methods are derived here; callers never provide a path or header.
/// Port of ShareRequestPolicy.java.
public enum ShareRequestPolicy {
    public static let maxRequestBytes = 1024 * 1024
    public static let maxResponseBytes = 2 * 1024 * 1024
    static let appHost = "qingke.local"

    public static func origin(_ value: String) throws -> String {
        guard !value.isEmpty, value.count <= 500, isPrintableASCII(value) else {
            throw SharePolicyError("请填写有效的 HTTPS 分享服务器地址")
        }
        guard let parts = URLComponents(string: value) else { throw SharePolicyError("服务器地址格式不正确") }
        let path = parts.percentEncodedPath
        guard parts.scheme?.lowercased() == "https", let host = parts.percentEncodedHost, !host.isEmpty,
              parts.percentEncodedUser == nil, parts.percentEncodedPassword == nil,
              parts.percentEncodedQuery == nil, parts.percentEncodedFragment == nil,
              path.isEmpty || path == "/", (parts.port.map { $0 > 0 && $0 <= 65535 } ?? true),
              host.lowercased() != appHost else {
            throw SharePolicyError("服务器地址只允许 HTTPS 主机和端口，不含路径、账号或参数")
        }
        let normalizedHost = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        return "https://" + normalizedHost.lowercased() + (parts.port.map { ":\($0)" } ?? "")
    }

    public static func endpoint(baseURL: String, action: String, code: String) throws -> String {
        let base = try origin(baseURL)
        if action == "create" { return base + "/api/shares" }
        if action == "transfer-create" { return base + "/api/transfers" }
        if action == "transfer-get" {
            guard code.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil else { throw SharePolicyError("换机码格式不正确") }
            return base + "/api/transfers/" + code
        }
        guard ["get", "delete", "update"].contains(action) else { throw SharePolicyError("不支持的分享操作") }
        guard code.range(of: "^[A-Za-z0-9_-]{20}$", options: .regularExpression) != nil else {
            throw SharePolicyError("分享码格式不正确，应为 20 位字符")
        }
        return base + "/api/shares/" + code
    }

    public static func method(_ action: String) throws -> String {
        switch action {
        case "create", "transfer-create": return "POST"
        case "get", "transfer-get": return "GET"
        case "delete": return "DELETE"
        case "update": return "PUT"
        default: throw SharePolicyError("不支持的分享操作")
        }
    }

    public static func bearer(_ token: String) throws -> String {
        guard token.range(of: "^[A-Za-z0-9._~+/=-]{16,512}$", options: .regularExpression) != nil else {
            throw SharePolicyError("删除凭据无效")
        }
        return "Bearer " + token
    }

    public static func requestBytes(_ json: String) throws -> Data {
        guard json.utf16.count <= maxRequestBytes, let data = json.data(using: .utf8), data.count <= maxRequestBytes else {
            throw SharePolicyError("分享内容超过 1 MB")
        }
        return data
    }

    public struct Request: Equatable {
        public let url: String, method: String, authorization: String?, body: Data?
    }

    /// Validates the WebView's request and rebuilds the envelope so unknown caller-supplied
    /// fields, headers, paths or tokens can never leak to the share server.
    public static func request(action: String, baseURL: String, payloadJSON: String) throws -> Request {
        let raw = try requestBytes(payloadJSON)
        guard let payload = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any] else {
            throw SharePolicyError("分享内容格式不正确")
        }
        let httpMethod = try Self.method(action)
        // Device transfer: an opaque id plus ciphertext sealed in the page; nothing else is forwarded.
        if action.hasPrefix("transfer-") {
            let id = payload["id"] as? String ?? ""
            let url = try endpoint(baseURL: baseURL, action: action, code: id)
            guard action == "transfer-create" else { return Request(url: url, method: httpMethod, authorization: nil, body: nil) }
            guard id.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil, let data = payload["data"] as? String,
                  data.utf8.count <= 128 * 1024, data.range(of: "^[A-Za-z0-9+/]+={0,2}$", options: .regularExpression) != nil else {
                throw SharePolicyError("换机数据格式不正确")
            }
            return Request(url: url, method: httpMethod, authorization: nil, body: try JSONSerialization.data(withJSONObject: ["id": id, "data": data]))
        }
        let url = try endpoint(baseURL: baseURL, action: action, code: payload["code"] as? String ?? "")
        let update = action == "update"
        var authorization: String?
        if action == "delete" || update { authorization = try bearer(payload["deleteToken"] as? String ?? "") }
        guard action == "create" || update else { return Request(url: url, method: httpMethod, authorization: authorization, body: nil) }

        func isBool(_ value: Any?) -> Bool { (value as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } ?? false }
        let expires = SchedulePlan.integer(payload["expiresInDays"]).map(Int.init)
        let revision = SchedulePlan.integer(payload["expectedRevision"]).map(Int.init) ?? 0
        guard payload["format"] as? String == "qingke-semester", SchedulePlan.integer(payload["version"]) == 1,
              let semester = payload["semester"] as? [String: Any], isBool(payload["includeNotes"]),
              payload["includeExams"] == nil || isBool(payload["includeExams"]),
              payload["allowFollow"] == nil || isBool(payload["allowFollow"]),
              (update && payload["expiresInDays"] == nil) || (1...365).contains(expires ?? 0),
              !update || revision >= 1 else {
            throw SharePolicyError("分享内容格式不正确")
        }
        var envelope: [String: Any] = [
            "format": "qingke-semester", "version": 1, "semester": semester,
            "includeNotes": (payload["includeNotes"] as? Bool) ?? false,
            "includeExams": (payload["includeExams"] as? Bool) ?? false,
            "allowFollow": (payload["allowFollow"] as? Bool) ?? false,
        ]
        if let expires, payload["expiresInDays"] != nil { envelope["expiresInDays"] = expires }
        if update { envelope["expectedRevision"] = revision }
        let body = try JSONSerialization.data(withJSONObject: envelope)
        guard body.count <= maxRequestBytes else { throw SharePolicyError("分享内容超过 1 MB") }
        return Request(url: url, method: httpMethod, authorization: authorization, body: body)
    }

    static func isPrintableASCII(_ text: String) -> Bool {
        text.unicodeScalars.allSatisfy { $0.value >= 0x21 && $0.value <= 0x7E }
    }
}

/// Pure validation only: external links never become a WebView navigation or a network request.
/// Port of ShareEntryPolicy.java.
public enum ShareEntryPolicy {
    public static let maxLinkCharacters = 2048
    public static let maxTextCharacters = 16 * 1024

    public struct Link: Equatable {
        public let code: String, server: String, id: String
        init(code: String, server: String) {
            self.code = code; self.server = server
            id = SHA256.hash(data: Data("\(code)\n\(server)".utf8)).map { String(format: "%02x", $0) }.joined()
        }
        public var url: String {
            // Same output as Java URLEncoder for an ASCII origin.
            let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.*")
            return "https://qk.sagiri.org/s#code=\(code)&server=" + (server.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
        }
    }

    public static func parse(_ url: String) -> Link? {
        guard !url.isEmpty, url.count <= maxLinkCharacters, ShareRequestPolicy.isPrintableASCII(url),
              let parts = URLComponents(string: url), parts.percentEncodedUser == nil,
              parts.percentEncodedPassword == nil, parts.port == nil else { return nil }
        let scheme = parts.scheme?.lowercased(), host = parts.percentEncodedHost?.lowercased()
        let parameters: String?
        if scheme == "https", host == "qk.sagiri.org", parts.percentEncodedPath == "/s", parts.percentEncodedQuery == nil {
            parameters = parts.percentEncodedFragment
        } else if scheme == "qingke", host == "share", parts.percentEncodedPath.isEmpty, parts.percentEncodedFragment == nil,
                  url.lowercased().hasPrefix("qingke://") {
            parameters = parts.percentEncodedQuery
        } else { return nil }
        guard let parameters else { return nil }
        let pieces = parameters.split(separator: "&", omittingEmptySubsequences: false)
        guard pieces.count == 2 else { return nil }
        var code: String?, server: String?
        for piece in pieces {
            guard let equals = piece.firstIndex(of: "="), equals > piece.startIndex else { return nil }
            let key = String(piece[..<equals])
            guard let value = decode(String(piece[piece.index(after: equals)...])) else { return nil }
            do {
                if key == "code" && code == nil { code = try normalizeCode(value) }
                else if key == "server" && server == nil { server = try ShareRequestPolicy.origin(value) }
                else { return nil }
            } catch { return nil }
        }
        guard let code, let server else { return nil }
        return Link(code: code, server: server)
    }

    public static func normalizeCode(_ value: String) throws -> String {
        let alphabet = "[0-9A-HJ-KM-NP-TV-Za-hj-km-np-tv-z]+"
        guard value.count <= 39, value.range(of: "^\(alphabet)(?:-\(alphabet))*$", options: .regularExpression) != nil else {
            throw SharePolicyError("分享口令格式不正确")
        }
        let code = value.replacingOccurrences(of: "-", with: "").uppercased()
        guard code.count == 20 else { throw SharePolicyError("分享口令应为 20 位字符") }
        return code
    }

    private static let candidate = try! NSRegularExpression(
        pattern: "(?:^|[\\s(<\\[【「《：])((?:https://qk\\.sagiri\\.org/s#|qingke://share\\?)[^\\s<>\"'\\[\\](){}\\u3000-\\u303f\\uff00-\\uffef]+)",
        options: [.caseInsensitive])

    /// An ambiguous message must be pasted manually; never silently choose another person's share.
    public static func fromClipboard(_ text: String?) -> Link? {
        guard let text, !text.isEmpty, text.utf16.count <= maxTextCharacters else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        var found: Link?
        for match in candidate.matches(in: text, range: range) {
            guard let group = Range(match.range(at: 1), in: text), let link = parse(String(text[group])) else { continue }
            if let existing = found, existing.id != link.id { return nil }
            found = link
        }
        return found
    }

    public static func validText(_ text: String?) -> Bool {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf16.count <= maxTextCharacters else { return false }
        return !text.unicodeScalars.contains { ($0.value <= 0x08) || $0.value == 0x0B || $0.value == 0x0C || (0x0E...0x1F).contains($0.value) || $0.value == 0x7F }
    }

    /// Strict percent-decoding: '+' stays literal (encodeURIComponent, not form encoding); invalid UTF-8 fails.
    static func decode(_ value: String) -> String? {
        var bytes: [UInt8] = []
        var iterator = Array(value.utf8).makeIterator()
        while let byte = iterator.next() {
            if byte == UInt8(ascii: "%") {
                guard let high = iterator.next().flatMap(hex), let low = iterator.next().flatMap(hex) else { return nil }
                bytes.append(high << 4 | low)
            } else { bytes.append(byte) }
        }
        return String(strictUTF8: bytes)
    }

    private static func hex(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 0x30...0x39: return byte - 0x30
        case 0x41...0x46: return byte - 0x41 + 10
        case 0x61...0x66: return byte - 0x61 + 10
        default: return nil
        }
    }
}

private extension String {
    init?(strictUTF8 bytes: [UInt8]) {
        guard let decoded = String(bytes: bytes, encoding: .utf8), Array(decoded.utf8) == bytes else { return nil }
        self = decoded
    }
}

/// Bounded handoff between URL opens / clipboard and the trusted WebView. Port of ShareEntryInbox.java.
public final class ShareEntryInbox {
    public static let maxPending = 8
    public static let maxRecent = 32

    public struct Entry: Equatable {
        public let link: ShareEntryPolicy.Link
        /// "link" (explicit tap) or "clipboard".
        public let source: String
    }

    private var pending: [Entry] = []
    private var recent: [String] = []
    private let lock = NSLock()

    public init() {}

    public func restoreRecent(_ hashes: String?) {
        lock.lock(); defer { lock.unlock() }
        recent.removeAll()
        guard let hashes, hashes.count <= Self.maxRecent * 65 else { return }
        for id in hashes.split(separator: ",").map(String.init)
        where id.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil && !recent.contains(id) {
            recent.append(id)
        }
        if recent.count > Self.maxRecent { recent.removeFirst(recent.count - Self.maxRecent) }
    }

    public var recentState: String { lock.lock(); defer { lock.unlock() }; return recent.joined(separator: ",") }

    @discardableResult
    public func offer(_ link: ShareEntryPolicy.Link?, source: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard let link, source == "link" || source == "clipboard" else { return false }
        let explicit = source == "link"
        if !explicit && recent.contains(link.id) { return false }
        if let index = pending.firstIndex(where: { $0.link.id == link.id }) {
            if !explicit || pending[index].source == "link" { return false }
            pending.remove(at: index) // An explicit tap supersedes a queued clipboard suggestion of the same share.
        }
        if pending.count == Self.maxPending {
            if !explicit { return false }
            pending.removeLast() // Preserve earlier explicit taps, evict a trailing clipboard suggestion first.
        }
        var index = pending.count
        if explicit { index = pending.firstIndex { $0.source != "link" } ?? pending.count }
        pending.insert(Entry(link: link, source: source), at: index)
        rememberLocked(link)
        return true
    }

    public func remember(_ link: ShareEntryPolicy.Link?) {
        lock.lock(); defer { lock.unlock() }
        if let link { rememberLocked(link) }
    }

    private func rememberLocked(_ link: ShareEntryPolicy.Link) {
        recent.removeAll { $0 == link.id }
        recent.append(link.id)
        if recent.count > Self.maxRecent { recent.removeFirst(recent.count - Self.maxRecent) }
    }

    public func poll() -> Entry? { lock.lock(); defer { lock.unlock() }; return pending.isEmpty ? nil : pending.removeFirst() }
    public var hasPending: Bool { lock.lock(); defer { lock.unlock() }; return !pending.isEmpty }
    public var hasExplicit: Bool { lock.lock(); defer { lock.unlock() }; return pending.contains { $0.source == "link" } }
    public func dropClipboard() { lock.lock(); defer { lock.unlock() }; pending.removeAll { $0.source == "clipboard" } }
}
