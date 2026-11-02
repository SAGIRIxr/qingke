import Foundation
import QingkeCore
import UserNotifications

/// Local reminders without a server. Android keeps one rolling exact alarm; iOS instead registers
/// the nearest alerts ahead of time (at most 64 per app), refilled on every launch, foreground and
/// background refresh. Times use the device's current calendar, so they follow the local clock.
final class NotificationScheduler {
    static let shared = NotificationScheduler()
    static let prefix = "qingke."
    private static let renewalID = "qingke.renewal"
    private static let planKey = "notificationPlan"
    private static let maxAlerts = 62
    private let center = UNUserNotificationCenter.current()
    private let queue = DispatchQueue(label: "cn.qingke.notifications")
    private(set) var lastPending = 0
    private static let allowedStatuses: [UNAuthorizationStatus] = [.authorized, .provisional, .ephemeral]

    /// Validates first; an invalid plan never replaces the saved one.
    func sync(_ json: String, completion: @escaping (Int) -> Void) throws {
        _ = try SchedulePlan.parse(json: json)
        UserDefaults.standard.set(json, forKey: Self.planKey)
        reschedule(completion: completion)
    }

    var savedPlan: SchedulePlan? {
        guard let json = UserDefaults.standard.string(forKey: Self.planKey) else { return nil }
        return try? SchedulePlan.parse(json: json)
    }

    func reschedule(completion: ((Int) -> Void)? = nil) {
        let plan = savedPlan
        center.getNotificationSettings { settings in
            let allowed = Self.allowedStatuses.contains(settings.authorizationStatus)
            self.center.getPendingNotificationRequests { requests in
                self.queue.async {
                    let ours = requests.map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
                    self.center.removePendingNotificationRequests(withIdentifiers: ours)
                    guard allowed, let plan, plan.enabled else { self.finish(0, completion); return }
                    let now = Int64(Date().timeIntervalSince1970 * 1000)
                    let (alerts, hasMore) = plan.pendingAlerts(after: now, limit: Self.maxAlerts)
                    for point in alerts {
                        let text = ReminderText.content(for: point)
                        let content = UNMutableNotificationContent()
                        content.title = text.title
                        content.body = text.body
                        content.sound = .default
                        content.threadIdentifier = "qingke.reminders"
                        let id = Self.prefix + point.key.replacingOccurrences(of: "\n", with: "|")
                        self.center.add(UNNotificationRequest(identifier: id, content: content, trigger: Self.trigger(at: point.at)))
                    }
                    if hasMore, let last = alerts.last {
                        // Without this the reminders would silently stop once the registered window runs out.
                        let content = UNMutableNotificationContent()
                        content.title = "清课 · 打开一下以继续提醒"
                        content.body = "后面的课前提醒需要打开清课续排，打开一次即可。"
                        content.sound = .default
                        self.center.add(UNNotificationRequest(identifier: Self.renewalID, content: content, trigger: Self.trigger(at: last.at + 60_000)))
                    }
                    self.finish(alerts.count, completion)
                }
            }
        }
    }

    private func finish(_ count: Int, _ completion: ((Int) -> Void)?) {
        lastPending = count
        DispatchQueue.main.async { completion?(count) }
    }

    func requestAuthorization(completion: @escaping () -> Void) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            self.reschedule { _ in completion() }
        }
    }

    func status(completion: @escaping ([String: Any]) -> Void) {
        let plan = savedPlan
        center.getNotificationSettings { settings in
            let granted = Self.allowedStatuses.contains(settings.authorizationStatus)
            let result: [String: Any] = ["granted": granted, "exact": true, "enabled": plan?.enabled ?? false,
                                         "ongoing": false, "pending": self.lastPending, "platform": "ios"]
            DispatchQueue.main.async { completion(result) }
        }
    }

    func test() {
        let content = UNMutableNotificationContent()
        content.title = "清课 · 通知测试"
        content.body = "通知可以显示；课程提醒将按你设置的时间发送"
        content.sound = .default
        center.add(UNNotificationRequest(identifier: "qingke-test", content: content,
                                         trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)))
    }

    /// Wall-clock components in the current calendar: a reminder for 08:00 stays at 08:00.
    private static func trigger(at milliseconds: Int64) -> UNCalendarNotificationTrigger {
        let date = Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        return UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
    }
}
