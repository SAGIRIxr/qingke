import UIKit

/// System tab bar (Liquid Glass on iOS 26) over the one shared timetable WebView. The page keeps its
/// own tab state: taps here are forwarded to it, and its tab and sheet changes are mirrored back.
final class MainTabController: UITabBarController, UITabBarControllerDelegate {
    static let tabs: [(key: String, title: String, symbol: String)] = [
        ("table", "课表", "square.grid.2x2"), ("today", "今天", "sun.max"), ("settings", "设置", "gearshape")]
    let timetable = WebViewController()
    private var modalOpen = false

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        view.backgroundColor = WebViewController.paper
        tabBar.tintColor = UIColor(red: 0.122, green: 0.361, blue: 0.282, alpha: 1)
        viewControllers = Self.tabs.map { tab in
            let slot = TabSlotViewController()
            slot.tabBarItem = UITabBarItem(title: tab.title, image: UIImage(systemName: tab.symbol),
                                           selectedImage: UIImage(systemName: tab.symbol + ".fill"))
            return slot
        }
        timetable.onChrome = { [weak self] tab, modal in self?.mirror(tab: tab, modal: modal) }
        host(in: viewControllers![0])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // The page reserves exactly the space the floating bar covers; a hidden bar keeps the last value.
        guard !modalOpen, !tabBar.isHidden, tabBar.frame.minY > 0 else { return }
        timetable.setChromeInsets(tabBar: view.bounds.height - tabBar.frame.minY,
                                  top: view.window?.safeAreaInsets.top ?? view.safeAreaInsets.top,
                                  bottom: view.window?.safeAreaInsets.bottom ?? 0)
    }

    func tabBarController(_ controller: UITabBarController, shouldSelect next: UIViewController) -> Bool {
        guard let index = viewControllers?.firstIndex(of: next) else { return false }
        // Tapping the current tab scrolls to the top, as in system apps (handled by the page).
        timetable.selectTab(Self.tabs[index].key)
        return true
    }

    func tabBarController(_ controller: UITabBarController, didSelect next: UIViewController) { host(in: next) }

    private func mirror(tab: String, modal: Bool) {
        if let index = Self.tabs.firstIndex(where: { $0.key == tab }), index != selectedIndex, let slot = viewControllers?[index] {
            selectedIndex = index
            host(in: slot)
        }
        guard modal != modalOpen else { return }
        modalOpen = modal
        // Web sheets slide up from the bottom; the bar steps aside instead of floating over them.
        if #available(iOS 18.0, *) { setTabBarHidden(modal, animated: true) } else { tabBar.isHidden = modal }
    }

    /// The WebView moves to whichever slot is selected, so the bar always floats over live content.
    private func host(in slot: UIViewController) {
        guard timetable.parent !== slot else { return }
        if timetable.parent != nil {
            timetable.willMove(toParent: nil)
            timetable.view.removeFromSuperview()
            timetable.removeFromParent()
        }
        slot.addChild(timetable)
        timetable.view.frame = slot.view.bounds
        timetable.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        slot.view.addSubview(timetable.view)
        timetable.didMove(toParent: slot)
    }
}

private final class TabSlotViewController: UIViewController {
    override func loadView() {
        view = UIView()
        view.backgroundColor = WebViewController.paper
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
}
