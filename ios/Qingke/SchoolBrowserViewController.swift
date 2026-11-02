import UIKit
import WebKit

/// Untrusted campus portal browser. It never receives the timetable bridge; the only data that
/// leaves it is the detached page capture produced when the user taps 导入此页.
final class SchoolBrowserViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, UITextFieldDelegate {
    private let startURL: URL
    private let finish: (String?) -> Void
    private var webView: WKWebView!
    private let address = UITextField()
    private let progress = UIProgressView(progressViewStyle: .bar)
    private var desktopMode = false
    private var observers: [NSKeyValueObservation] = []
    private var captureItem: UIBarButtonItem!
    private var backItem: UIBarButtonItem!
    private var finished = false

    init(url: URL, finish: @escaping (String?) -> Void) {
        startURL = url
        self.finish = finish
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// Same rule as Android: http(s) with a host, no credentials, never the app's own origin.
    static func validSchoolURL(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 4096, text.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil else { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
              !AppSchemeHandler.isAppURL(url) else { return nil }
        return url
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        progress.translatesAutoresizingMaskIntoConstraints = false
        progress.tintColor = UIColor(red: 0.12, green: 0.36, blue: 0.28, alpha: 1)
        view.addSubview(webView)
        view.addSubview(progress)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progress.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        address.text = startURL.absoluteString
        address.font = .preferredFont(forTextStyle: .subheadline)
        address.textAlignment = .center
        address.borderStyle = .none
        address.backgroundColor = .tertiarySystemFill
        address.layer.cornerRadius = 10
        address.keyboardType = .URL
        address.autocapitalizationType = .none
        address.autocorrectionType = .no
        address.returnKeyType = .go
        address.clearButtonMode = .whileEditing
        address.delegate = self
        address.frame = CGRect(x: 0, y: 0, width: 260, height: 36)
        navigationItem.titleView = address
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(reload))

        backItem = UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), style: .plain, target: self, action: #selector(goBack))
        let desktop = UIBarButtonItem(image: UIImage(systemName: "desktopcomputer"), style: .plain, target: self, action: #selector(toggleDesktop(_:)))
        captureItem = UIBarButtonItem(title: "导入此页", style: .done, target: self, action: #selector(capture))
        toolbarItems = [backItem, .fixedSpace(16), desktop, .flexibleSpace(), captureItem]
        navigationController?.isToolbarHidden = false

        observers = [
            webView.observe(\.estimatedProgress) { [weak self] web, _ in
                self?.progress.progress = Float(web.estimatedProgress)
                self?.progress.isHidden = web.estimatedProgress >= 1
            },
            webView.observe(\.canGoBack) { [weak self] web, _ in self?.backItem.isEnabled = web.canGoBack },
        ]
        backItem.isEnabled = false
        webView.load(URLRequest(url: startURL))
    }

    @objc private func close() { done(nil) }
    @objc private func reload() { webView.reload() }
    @objc private func goBack() { if webView.canGoBack { webView.goBack() } }

    @objc private func toggleDesktop(_ item: UIBarButtonItem) {
        desktopMode.toggle()
        item.image = UIImage(systemName: desktopMode ? "iphone" : "desktopcomputer")
        webView.reload()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        guard let url = Self.validSchoolURL(textField.text ?? "") else {
            message("请输入有效的 http 或 https 教务网址"); return false
        }
        textField.resignFirstResponder()
        webView.load(URLRequest(url: url))
        return true
    }

    /// Detached-clone capture shared with Android; credentials, form values and cookies stay behind.
    @objc private func capture() {
        captureItem.isEnabled = false
        captureItem.title = "读取中…"
        webView.evaluateJavaScript(BridgeScript.schoolCapture) { [weak self] result, _ in
            guard let self else { return }
            self.captureItem.isEnabled = true
            self.captureItem.title = "导入此页"
            guard let text = result as? String, let data = text.data(using: .utf8),
                  let capture = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                return self.message("读取失败，请等待课表加载完成后重试")
            }
            if let error = capture["error"] as? String { return self.message(error) }
            let pageText = (capture["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let html = (capture["html"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if pageText.isEmpty && html.isEmpty { return self.message("页面内容为空，请打开完整课表后重试") }
            self.done(BridgeScript.json(capture))
        }
    }

    private func done(_ capture: String?) {
        guard !finished else { return }
        finished = true
        webView.stopLoading()
        dismiss(animated: true) { self.finish(capture) }
    }

    private func message(_ text: String) {
        let alert = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default))
        present(alert, animated: true)
    }

    // MARK: Navigation policy

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        preferences.preferredContentMode = desktopMode ? .desktop : .mobile
        let url = action.request.url
        let inPortal = url.map { Self.validSchoolURL($0.absoluteString) != nil } ?? false
        let allowed = inPortal || ["about", "blob", "data"].contains(url?.scheme ?? "")
        if !allowed && action.targetFrame?.isMainFrame != false { message("此链接不能在教务导入页打开") }
        decisionHandler(allowed ? .allow : .cancel, preferences)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard !address.isFirstResponder, let url = webView.url, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        parts.query = nil
        parts.fragment = nil
        address.text = parts.string
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let certificateErrors: [URLError.Code] = [.serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid]
        guard let code = (error as? URLError)?.code, code != .cancelled else { return }
        if certificateErrors.contains(code) {
            message("网站证书校验失败，已停止连接。请联系学校或检查系统时间。")
        } else {
            message("页面未能打开，请检查网址和校园网 / VPN 后刷新。")
        }
    }

    /// target=_blank links open in the same isolated page instead of a new window.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url, Self.validSchoolURL(url.absoluteString) != nil {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    // Portal pages occasionally use alert/confirm for login errors and session prompts.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: frame.request.url?.host, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: frame.request.url?.host, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}
