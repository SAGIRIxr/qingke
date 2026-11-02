import Foundation
import WebKit

/// Serves the bundled `www/` folder at qingke-app://localhost/ (Android: https://qingke.local).
/// Request paths are resolved inside the bundle folder only; nothing else is reachable.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "qingke-app"
    static let host = "localhost"
    static let startURL = URL(string: "\(scheme)://\(host)/index.html")!
    private static let csp = "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    private let root: URL? = Bundle.main.url(forResource: "www", withExtension: nil)?.standardizedFileURL

    static func isAppURL(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == scheme && url.host == host && url.user == nil && url.port == nil
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, Self.isAppURL(url), (task.request.httpMethod ?? "GET") == "GET", let root else {
            return respond(task, status: 403, type: "text/plain", data: Data())
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        if path.contains("..") || path.contains("\\") { return respond(task, status: 403, type: "text/plain", data: Data()) }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            return respond(task, status: 404, type: "text/plain", data: Data())
        }
        respond(task, status: 200, type: Self.mime(file.pathExtension.lowercased()), data: data)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, status: Int, type: String, data: Data) {
        let headers = ["Content-Type": type, "Content-Length": String(data.count), "Content-Security-Policy": Self.csp,
                       "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"]
        guard let url = task.request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private static func mime(_ ext: String) -> String {
        switch ext {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "woff2": return "font/woff2"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }
}
