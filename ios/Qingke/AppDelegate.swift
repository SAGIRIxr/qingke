import BackgroundTasks
import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static let refreshTask = "cn.qingke.app.refresh"
    var window: UIWindow?
    private var timetable: WebViewController? { window?.rootViewController as? WebViewController }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshTask, using: nil) { task in
            // Keep the 64-notification window filled even when the app is not opened for days.
            Self.scheduleRefresh()
            task.expirationHandler = { task.setTaskCompleted(success: false) }
            NotificationScheduler.shared.reschedule { _ in task.setTaskCompleted(success: true) }
        }
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        if let url = launchOptions?[.url] as? URL { timetable?.acceptShareURL(url) }
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        timetable?.acceptShareURL(url)
        return true
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        guard let url = userActivity.webpageURL else { return false }
        timetable?.acceptShareURL(url)
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) { Self.scheduleRefresh() }

    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTask)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 6 * 3600)
        try? BGTaskScheduler.shared.submit(request)
    }

    // Show reminders as banners while the timetable is open, like Android heads-up notifications.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
}
