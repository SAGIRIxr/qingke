import Foundation

/// iOS may purge WKWebView website data when the device is low on storage. Every `qingke.*`
/// localStorage key is mirrored into the app's own Application Support folder, and the bridge
/// script restores them if the WebView comes up with none of its keys.
final class StorageMirror {
    static let shared = StorageMirror()
    private let queue = DispatchQueue(label: "cn.qingke.storage-mirror")
    private var values: [String: String]
    private var pendingWrite: DispatchWorkItem?
    private let file: URL

    private init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        file = folder.appendingPathComponent("qingke-storage-mirror.json")
        if let data = try? Data(contentsOf: file), let saved = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            values = saved.filter { $0.key.hasPrefix("qingke.") }
        } else {
            values = [:]
        }
    }

    /// Snapshot for the document-start script (read once per WebView creation).
    var snapshot: [String: String] { queue.sync { values } }

    func set(_ key: String, _ value: String) {
        guard key.hasPrefix("qingke."), key.utf16.count <= 200 else { return }
        queue.async { self.values[key] = value; self.scheduleWrite() }
    }

    func remove(_ key: String) { queue.async { self.values[key] = nil; self.scheduleWrite() } }

    func replace(_ all: [String: String]) {
        queue.async { self.values = all.filter { $0.key.hasPrefix("qingke.") }; self.scheduleWrite() }
    }

    func clear() { queue.async { self.values = [:]; self.scheduleWrite() } }

    /// Several saves in quick succession produce one file write.
    private func scheduleWrite() {
        pendingWrite?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let data = try? JSONSerialization.data(withJSONObject: self.values) else { return }
            try? data.write(to: self.file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        pendingWrite = work
        queue.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    /// Flush immediately, for example when the app moves to the background.
    func flush() {
        queue.sync {
            guard let work = pendingWrite, !work.isCancelled else { return }
            work.cancel()
            if let data = try? JSONSerialization.data(withJSONObject: values) {
                try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        }
    }
}
