# 清课 iOS 版

iOS 版沿用 Android 的结构：同一套 `www/` 网页内核，加一个原生壳。网页通过 `window.Android.*` 调用原生能力，
iOS 壳注入一个**同名的** `window.Android` 垫片（`platform: 'ios'`），网页按平台调整少量界面。

## 结构

- `QingkeCore/`：纯 Foundation 的 Swift 包，移植 Android 的 `SchedulePlan`（含 3.3.3 的每次课程提示时间）、
  `ShareRequestPolicy`、`ShareEntryPolicy`、`ShareEntryInbox` 和通知文案。`swift test --package-path ios/QingkeCore`。
- `Qingke/`：App 壳（UIKit + WKWebView）
  - `MainTabController`：系统标签栏（iOS 26 上即 Liquid Glass）浮在同一个 WebView 上。网页仍是标签状态的唯一来源：
    点原生标签调 `onNativeTab`，网页切页/开关弹出层时经 `setChrome` 回报，弹出层打开时标签栏让开；
    标签栏占用的高度和安全区通过 `--tabbar/--sat/--sab` 传给网页。
  - `AppSchemeHandler`：`qingke-app://localhost/` 只读包内 `www/`，带同样的 CSP / nosniff / no-store。
  - `BridgeScript` + `WebViewController`：垫片与白名单消息；同步 getter 读原生推送的缓存。
  - `NotificationScheduler`：本地通知。iOS 每个 App 最多 64 条待发通知，只排最近 62 条提醒 +
    1 条「打开清课续排」；启动、回到前台和后台刷新（`BGAppRefreshTask`）时补排。
  - `ShareTransport`：分享请求（无 Cookie、无缓存、不跟随重定向、响应限 2 MB）。
  - `SchoolBrowserViewController`：教务网页，独立 WKWebView，不挂桥；地址栏、桌面版切换、「导入此页」。
  - `StorageMirror`：`qingke.*` 的 localStorage 同步到 App 沙盒文件，WKWebView 数据被系统清掉时自动恢复。
- `project.yml`：XcodeGen 工程定义；`ci/`：模拟器截图用的示例课表与模拟器选择脚本。

## 界面

`www/platform.js` 识别 iOS 后给 `<html>` 加 `platform-ios`，`www/ios.css` 只在这个类下生效：系统字体、
大标题（滚动后在顶部居中显示小标题）、iOS 分段控件和开关、单色图标的分组列表、胶囊按钮，以及毛玻璃——
渐隐的顶部滚动边缘、吸顶的星期行、悬浮圆角的弹出层和提示条用真实模糊；大面积卡片用半透明（背景本身是柔和渐变，
模糊和半透明看起来一样，但滚动时不耗 GPU）。浏览器里加 `?platform=ios` 可预览（没有原生标签栏时用网页自带的悬浮胶囊）。

iOS 上隐藏 Android 专有的设置：后台与省电、应用内更新、常驻课程状态通知（以后用 Live Activity）。

## 与 Android 的差异

| 功能 | iOS |
| --- | --- |
| 准时提醒 | 预先登记本地通知，跟随设备当地时间；不需要额外权限 |
| 常驻状态通知 | 暂不支持 |
| 分享链接 | `qingke://share` 可直接唤起；`https://qk.sagiri.org/s` 的 Universal Link 需要付费开发者账号 |
| 剪贴板识别 | 默认关闭（iOS 每次读取剪贴板都会弹确认）；开启后只在检测到链接时读取 |
| 返回 | 从屏幕左边缘右滑，逐层返回 |

## 构建与安装（不需要 Mac）

推送 `ios` 分支会触发 `.github/workflows/ios.yml`（macOS runner）：核心测试 → 生成工程 → 模拟器构建与截图 →
无签名 `.ipa`。在 Actions 页面下载 `ios-unsigned-ipa`，Windows 上用 Sideloadly + Apple ID 安装到 iPhone
（免费账号 7 天需重签一次）。上架或长期分发需要 Apple Developer 账号（$99/年），届时再加签名和 TestFlight。
