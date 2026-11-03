import Foundation
import QingkeCore

/// Narrow HTTPS sharing transport (Android ShareClient). No cookies, caches or redirects; the
/// request envelope is rebuilt by ShareRequestPolicy so page code cannot add headers or paths.
final class ShareTransport: NSObject, URLSessionTaskDelegate {
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 40
        configuration.httpMaximumConnectionsPerHost = 2
        // The first request of a fresh install races the system "allow cellular data" prompt (China
        // models) and the radio waking up; wait for a usable path instead of failing at once.
        configuration.waitsForConnectivity = true
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()
    private var active = Set<String>()
    private let lock = NSLock()

    /// `deliver` is called on the main queue with the same result shape as Android.
    func request(id: String, action: String, baseURL: String, payload: String, deliver: @escaping ([String: Any]) -> Void) {
        func finish(_ ok: Bool, _ status: Int, _ data: Any?, _ message: String?) {
            var result: [String: Any] = ["requestId": id, "ok": ok, "status": status]
            if let data { result["data"] = data }
            if let message { result["message"] = String(message.prefix(300)) }
            DispatchQueue.main.async { deliver(result) }
        }
        guard id.range(of: "^[A-Za-z0-9_.:-]{1,100}$", options: .regularExpression) != nil else { return finish(false, 0, nil, "请求标识无效") }
        let request: ShareRequestPolicy.Request
        do { request = try ShareRequestPolicy.request(action: action, baseURL: baseURL, payloadJSON: payload) }
        catch { return finish(false, 0, nil, (error as? LocalizedError)?.errorDescription ?? "分享内容格式不正确") }
        guard let url = URL(string: request.url) else { return finish(false, 0, nil, "分享服务地址无效") }
        lock.lock()
        // A retried bridge call with the same ID shares the original result, not a second POST.
        let duplicate = !active.insert(id).inserted
        let busy = active.count > 2
        if busy { active.remove(id) }
        lock.unlock()
        if duplicate { return }
        if busy { return finish(false, 429, nil, "正在处理其他分享请求，请稍后重试") }

        var http = URLRequest(url: url)
        http.httpMethod = request.method
        http.setValue("application/json", forHTTPHeaderField: "Accept")
        http.setValue("Qingke-Share/1", forHTTPHeaderField: "User-Agent")
        if let authorization = request.authorization { http.setValue(authorization, forHTTPHeaderField: "Authorization") }
        if let body = request.body {
            http.httpBody = body
            http.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        }
        func handle(_ data: Data?, _ response: URLResponse?, _ error: Error?) {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let error = error as? URLError {
                switch error.code {
                case .timedOut: return finish(false, status, nil, "分享请求超时，请检查网络后重试")
                case .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot, .secureConnectionFailed:
                    return finish(false, status, nil, "分享服务器证书验证失败，请检查地址与系统时间")
                default: return finish(false, status, nil, "无法连接分享服务器，请检查地址与网络后重试")
                }
            }
            if error != nil { return finish(false, status, nil, "无法连接分享服务器，请检查地址与网络后重试") }
            if (300..<400).contains(status) { return finish(false, status, nil, "分享服务器发生重定向，请填写最终 HTTPS 地址") }
            let bytes = data ?? Data()
            if bytes.count > ShareRequestPolicy.maxResponseBytes { return finish(false, status, nil, "服务器响应超过 2 MB") }
            var json: [String: Any]?
            if !bytes.isEmpty {
                guard let parsed = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] else {
                    return finish(false, status, nil, "分享服务器返回的内容不是有效 JSON")
                }
                json = parsed
            }
            let ok = (200..<300).contains(status)
            var message: String?
            if !ok {
                let error = json?["error"] as? [String: Any]
                message = error?["message"] as? String ?? json?["message"] as? String ?? json?["error"] as? String ?? "服务器返回 \(status)"
            }
            finish(ok, status, json, message)
        }
        func send(attempt: Int) {
            session.dataTask(with: http) { [weak self] data, response, error in
                if attempt == 0, let code = (error as? URLError)?.code, Self.retryable(code, method: request.method) {
                    return DispatchQueue.global().asyncAfter(deadline: .now() + 1.2) { send(attempt: 1) }
                }
                self?.lock.lock(); self?.active.remove(id); self?.lock.unlock()
                handle(data, response, error)
            }.resume()
        }
        send(attempt: 0)
    }

    /// One quiet retry for failures that happen before the request reaches the server, so even a
    /// POST cannot be applied twice. A dropped connection is retried only for reads.
    private static func retryable(_ code: URLError.Code, method: String) -> Bool {
        switch code {
        case .notConnectedToInternet, .dataNotAllowed, .cannotFindHost, .dnsLookupFailed, .cannotConnectToHost: return true
        case .networkConnectionLost: return method == "GET"
        default: return false
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
