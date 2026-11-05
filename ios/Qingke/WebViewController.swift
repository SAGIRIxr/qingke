import QingkeCore
import UIKit
import UniformTypeIdentifiers
import WebKit

/// Hosts the shared web timetable. Mirrors Android MainActivity: one trusted WebView with a fixed
/// bridge, and a separate untrusted school browser that never sees the bridge.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate, UIGestureRecognizerDelegate {
    private static let maxBackupBytes = 5 * 1024 * 1024
    private static let maxPDFBytes = 20 * 1024 * 1024
    static let paper = UIColor(red: 0.933, green: 0.949, blue: 0.929, alpha: 1)
    private static let tabKeys: Set = ["table", "today", "settings"]
    /// The page's current tab and whether a sheet is open, for the native tab bar.
    var onChrome: ((String, Bool) -> Void)?
    private var chromeInsets = ""
    /// Returning jumps to the current week only after a real absence; closing the screenshot editor,
    /// Control Center or a share sheet must leave the week the user was looking at.
    private static let resetAfter: TimeInterval = 10 * 60
    private var backgroundedAt: Date?
    private var webView: WKWebView!
    private let share = ShareTransport()
    private let inbox = ShareEntryInbox()
    private var pageReady = false
    private var schoolOpen = false
    private var pickerKind: String?
    private var lastPasteboardChange = -1
    private let defaults = UserDefaults.standard

    // MARK: Lifecycle

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsInlineMediaPlayback = false
        configuration.dataDetectorTypes = []
        let controller = configuration.userContentController
        controller.add(WeakMessageHandler(self), name: "qingke")
        controller.addUserScript(WKUserScript(source: BridgeScript.source(initial: initialNativeState(), mirror: StorageMirror.shared.snapshot,
                                                                            demoState: Self.demoState()),
                                              injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = Self.paper
        webView.scrollView.backgroundColor = webView.backgroundColor
        // The page draws under the status bar and home indicator and pads with env(safe-area-inset-*).
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        inbox.restoreRecent(defaults.string(forKey: "share.recentHashes"))
        // Swiping in from the left edge goes back one sheet/tab, like the Android back button.
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeBack(_:)))
        edge.edges = .left
        edge.delegate = self
        webView.addGestureRecognizer(edge)
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        webView.load(URLRequest(url: AppSchemeHandler.startURL))
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    @objc private func edgeBack(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard gesture.state == .ended, gesture.translation(in: webView).x > 60 else { return }
        webView.evaluateJavaScript("typeof window.onNativeBack==='function'&&window.onNativeBack()", completionHandler: nil)
    }

    @objc private func didBecomeActive() {
        guard pageReady, !schoolOpen else { return }
        if let since = backgroundedAt, Date().timeIntervalSince(since) >= Self.resetAfter {
            webView.evaluateJavaScript("window.onAppForeground&&window.onAppForeground()", completionHandler: nil)
        }
        backgroundedAt = nil
        NotificationScheduler.shared.reschedule { [weak self] _ in self?.pushNotificationStatus() }
        readShareClipboard()
        deliverShareEntries()
    }

    @objc private func willResignActive() { StorageMirror.shared.flush() }

    @objc private func didEnterBackground() { backgroundedAt = Date() }

    private func initialNativeState() -> [String: Any] {
        ["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
         "notificationStatus": ["granted": false, "exact": true, "enabled": NotificationScheduler.shared.savedPlan?.enabled ?? false,
                                "ongoing": false, "platform": "ios"],
         "shareEntrySettings": ["clipboardEnabled": clipboardEnabled], "nativeTabs": true]
    }

    // iOS asks before every programmatic paste, so clipboard detection is opt-in here.
    private var clipboardEnabled: Bool { defaults.bool(forKey: "share.clipboardEnabled") }

    // MARK: Navigation (only the bundled app pages)

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allowed = AppSchemeHandler.isAppURL(action.request.url) && action.request.url?.path == "/index.html"
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { pageReady = false }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        pushChromeInsets()
        pushNotificationStatus()
        runDemoScript()
        readShareClipboard()
        deliverShareEntries()
    }

    /// The web process can be killed while backgrounded; reload instead of showing a blank page.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        webView.load(URLRequest(url: AppSchemeHandler.startURL))
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    // MARK: Bridge

    fileprivate func receive(_ message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, AppSchemeHandler.isAppURL(message.frameInfo.request.url),
              let body = message.body as? [String: Any], let method = body["method"] as? String else { return }
        let args = body["args"] as? [Any] ?? []
        func string(_ index: Int) -> String? { index < args.count ? args[index] as? String : nil }
        switch method {
        case "syncSchedule":
            guard let json = string(0) else { return }
            do { try NotificationScheduler.shared.sync(json) { [weak self] _ in self?.pushNotificationStatus() } }
            catch { dispatch("onScheduleSyncError", BridgeScript.json(["message": (error as? LocalizedError)?.errorDescription ?? "提醒计划无效"])) }
        case "requestNotifications":
            NotificationScheduler.shared.requestAuthorization { [weak self] in self?.pushNotificationStatus() }
        case "openNotificationSettings":
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
        case "testNotification":
            NotificationScheduler.shared.test()
        case "exportBackup":
            if let json = string(0) { exportBackup(json) }
        case "importBackup":
            presentPicker(kind: "backup", types: [.json, .plainText, .data])
        case "importPdf":
            presentPicker(kind: "pdf", types: [.pdf])
        case "openSchool":
            if let url = string(0) { openSchool(url) }
        case "shareRequest":
            guard let id = string(0), let action = string(1), let base = string(2), let payload = string(3) else { return }
            share.request(id: id, action: action, baseURL: base, payload: payload) { [weak self] result in
                self?.dispatch("onShareResult", BridgeScript.json(result))
            }
        case "shareText":
            guard let text = string(0), ShareEntryPolicy.validText(text) else { return }
            rememberOwnShare(text)
            let activity = UIActivityViewController(activityItems: [text], applicationActivities: nil)
            activity.popoverPresentationController?.sourceView = view
            activity.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            topPresenter.present(activity, animated: true)
        case "copyText":
            guard let text = string(0), ShareEntryPolicy.validText(text) else { return }
            UIPasteboard.general.string = text
            lastPasteboardChange = UIPasteboard.general.changeCount
            rememberOwnShare(text)
        case "setClipboardShareEnabled":
            let enabled = args.first as? Bool ?? false
            defaults.set(enabled, forKey: "share.clipboardEnabled")
            if !enabled { inbox.dropClipboard() }
        case "mirrorSet":
            if let key = string(0), let value = string(1) { StorageMirror.shared.set(key, value) }
        case "mirrorRemove":
            if let key = string(0) { StorageMirror.shared.remove(key) }
        case "mirrorReplace":
            if let all = args.first as? [String: String] { StorageMirror.shared.replace(all) }
        case "mirrorClear":
            StorageMirror.shared.clear()
        case "chrome":
            guard let tab = string(0), Self.tabKeys.contains(tab) else { return }
            onChrome?(tab, args.count > 1 && args[1] as? Bool == true)
        case "log":
            #if DEBUG
            NSLog("[QingkeWeb] %@", string(0) ?? "")
            #endif
        default:
            break
        }
    }

    /// Same contract as Android: call window[function](argument), retrying while modules load.
    func dispatch(_ function: String, _ argument: String, attempt: Int = 0) {
        guard function.range(of: "^on[A-Za-z]+$", options: .regularExpression) != nil else { return }
        let script = "(function(){if(typeof window.\(function)!=='function')return false;window.\(function)(\(argument));return true})()"
        webView.evaluateJavaScript(script) { [weak self] result, _ in
            if result as? Bool == true || function == "onBackupSaved" { return }
            if attempt < 20 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self?.dispatch(function, argument, attempt: attempt + 1) } }
        }
    }

    private func pushNotificationStatus() {
        NotificationScheduler.shared.status { [weak self] status in
            let json = BridgeScript.json(status)
            self?.webView.evaluateJavaScript("window.__qingkeNativeUpdate&&window.__qingkeNativeUpdate({notificationStatus:\(json)})", completionHandler: nil)
            self?.dispatch("onNotificationStatus", json)
        }
    }

    // MARK: Native tab bar

    func selectTab(_ key: String) {
        guard Self.tabKeys.contains(key) else { return }
        dispatch("onNativeTab", BridgeScript.literal(key))
    }

    /// Bar and safe-area sizes as CSS variables; env() inside a tab child would include the bar.
    func setChromeInsets(tabBar: CGFloat, top: CGFloat, bottom: CGFloat) {
        let css = String(format: "--tabbar:%.1fpx;--sat:%.1fpx;--sab:%.1fpx", tabBar, top, bottom)
        guard css != chromeInsets else { return }
        chromeInsets = css
        pushChromeInsets()
    }

    private func pushChromeInsets() {
        guard pageReady, isViewLoaded, !chromeInsets.isEmpty else { return }
        webView.evaluateJavaScript("document.documentElement.style.cssText=\(BridgeScript.literal(chromeInsets))", completionHandler: nil)
    }

    private func toast(_ message: String) { dispatch("onNativeMessage", BridgeScript.literal(message)) }

    private var topPresenter: UIViewController {
        var top: UIViewController = self
        while let next = top.presentedViewController { top = next }
        return top
    }

    // MARK: Files

    private func exportBackup(_ json: String) {
        guard json.utf8.count <= Self.maxBackupBytes else { return toast("备份内容过大") }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmm"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("清课备份-\(formatter.string(from: Date())).json")
        do { try Data(json.utf8).write(to: url, options: .atomic) } catch { return toast("备份保存失败，请稍后重试") }
        pickerKind = "export"
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = self
        topPresenter.present(picker, animated: true)
    }

    private func presentPicker(kind: String, types: [UTType]) {
        guard presentedViewController == nil else { return toast("请先完成当前文件选择") }
        pickerKind = kind
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        topPresenter.present(picker, animated: true)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { pickerKind = nil }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let kind = pickerKind
        pickerKind = nil
        guard let url = urls.first else { return }
        switch kind {
        case "export":
            dispatch("onBackupSaved", "true")
        case "backup":
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                guard size <= Self.maxBackupBytes, var text = (try? Data(contentsOf: url)).flatMap({ String(data: $0, encoding: .utf8) }) else {
                    DispatchQueue.main.async { self?.toast("无法读取备份，请选择有效的清课 JSON 文件（小于 5 MB）") }; return
                }
                if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
                guard (try? JSONSerialization.jsonObject(with: Data(text.utf8))) is [String: Any] else {
                    DispatchQueue.main.async { self?.toast("无法读取备份，请选择有效的清课 JSON 文件（小于 5 MB）") }; return
                }
                let literal = BridgeScript.literal(text)
                DispatchQueue.main.async { self?.dispatch("onBackupLoaded", literal) }
            }
        case "pdf":
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                guard size <= Self.maxPDFBytes, let data = try? Data(contentsOf: url), data.count <= Self.maxPDFBytes else {
                    DispatchQueue.main.async { self?.dispatch("onPdfError", BridgeScript.json(["message": "PDF 超过 20 MB，请选择较小的文件"])) }; return
                }
                guard String(decoding: data.prefix(1024), as: UTF8.self).contains("%PDF-") else {
                    DispatchQueue.main.async { self?.dispatch("onPdfError", BridgeScript.json(["message": "这不是有效的 PDF 文件"])) }; return
                }
                let base64 = data.base64EncodedString()
                DispatchQueue.main.async { self?.sendPDF(name: url.lastPathComponent, base64: base64, offset: base64.startIndex) }
            }
        default:
            break
        }
    }

    /// Bounded script calls even for a 20 MB file; only the final callback exposes the data.
    private func sendPDF(name: String, base64: String, offset: String.Index) {
        let end = base64.index(offset, offsetBy: 192 * 1024, limitedBy: base64.endIndex) ?? base64.endIndex
        let part = "\"" + base64[offset..<end] + "\""
        let script = (offset == base64.startIndex ? "window.__qingkePdfParts=[];" : "") + "window.__qingkePdfParts.push(\(part));"
        webView.evaluateJavaScript(script) { [weak self] _, _ in
            guard let self else { return }
            if end < base64.endIndex { return self.sendPDF(name: name, base64: base64, offset: end) }
            let assemble = "window.__qingkePdfPayload={name:\(BridgeScript.literal(name)),base64:window.__qingkePdfParts.join('')};delete window.__qingkePdfParts;"
            self.webView.evaluateJavaScript(assemble) { _, _ in
                self.dispatch("onPdfLoaded", "window.__qingkePdfPayload")
            }
        }
    }

    // MARK: School browser

    private func openSchool(_ raw: String) {
        guard let url = SchoolBrowserViewController.validSchoolURL(raw) else { return toast("请输入有效的 http 或 https 教务网址") }
        schoolOpen = true
        let browser = SchoolBrowserViewController(url: url) { [weak self] capture in
            guard let self else { return }
            self.schoolOpen = false
            if let capture { self.dispatch("onSchoolCapture", capture) }
            self.deliverShareEntries()
        }
        let navigation = UINavigationController(rootViewController: browser)
        navigation.modalPresentationStyle = .fullScreen
        present(navigation, animated: true)
    }

    // MARK: Share links and clipboard

    func acceptShareURL(_ url: URL) {
        guard let link = ShareEntryPolicy.parse(url.absoluteString) else { return }
        if inbox.offer(link, source: "link") { defaults.set(inbox.recentState, forKey: "share.recentHashes") }
        deliverShareEntries()
    }

    private func rememberOwnShare(_ text: String) {
        // Copying our own share must not suggest importing it when the app returns.
        inbox.remember(ShareEntryPolicy.fromClipboard(text))
        defaults.set(inbox.recentState, forKey: "share.recentHashes")
    }

    private func readShareClipboard() {
        let board = UIPasteboard.general
        guard clipboardEnabled, !inbox.hasExplicit, board.changeCount != lastPasteboardChange else { return }
        lastPasteboardChange = board.changeCount
        // Pattern detection does not trigger the paste prompt; only a likely link is read.
        board.detectPatterns(for: [.probableWebURL]) { [weak self] result in
            guard case .success(let found) = result, found.contains(.probableWebURL) else { return }
            DispatchQueue.main.async {
                guard let self, let link = ShareEntryPolicy.fromClipboard(board.string) else { return }
                if self.inbox.offer(link, source: "clipboard") { self.defaults.set(self.inbox.recentState, forKey: "share.recentHashes") }
                self.deliverShareEntries()
            }
        }
    }

    private func deliverShareEntries() {
        guard pageReady, !schoolOpen, UIApplication.shared.applicationState == .active, inbox.hasPending else { return }
        var entries: [[String: Any]] = []
        while let entry = inbox.poll() {
            if entry.source == "clipboard" && !clipboardEnabled { continue }
            entries.append(["code": entry.link.code, "server": entry.link.server, "source": entry.source, "id": entry.link.id])
        }
        guard !entries.isEmpty else { return }
        webView.evaluateJavaScript("window.__qingkeNativeEnqueue&&window.__qingkeNativeEnqueue(\(BridgeScript.json(entries)))") { [weak self] _, _ in
            self?.dispatch("onShareLinkAvailable", "")
        }
    }

    // MARK: Simulator screenshots (debug builds only)

    private static func demoState() -> String? {
        #if DEBUG
        if let path = ProcessInfo.processInfo.environment["QINGKE_DEMO_STATE_FILE"] { return try? String(contentsOfFile: path, encoding: .utf8) }
        #endif
        return nil
    }

    private func runDemoScript() {
        #if DEBUG
        if let script = ProcessInfo.processInfo.environment["QINGKE_DEMO_SCRIPT"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.webView.evaluateJavaScript(script, completionHandler: nil) }
        }
        #endif
    }
}

/// WKUserContentController retains its handlers; a weak proxy avoids a cycle with the controller.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WebViewController?
    init(_ target: WebViewController) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { target?.receive(message) }
}
