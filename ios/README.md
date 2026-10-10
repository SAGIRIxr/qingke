# 清课 iOS 版（进行中）

iOS 版沿用 Android 的结构：同一套 `www/` 网页内核，加一个原生壳。网页通过 `window.Android.*` 调用原生能力，
iOS 壳会注入一个**同名的** `window.Android` 垫片，所以第一版不需要改 `www/`。

## 进度

- [x] `QingkeCore`：纯 Foundation 的 Swift 包，逐行移植 Android 的 `SchedulePlan`、`ShareRequestPolicy`、
      `ShareEntryPolicy`、`ShareEntryInbox`，外加通知文案 `ReminderText`。测试移植自 `android/native-tests`。
      运行：`swift test --package-path ios/QingkeCore`（需要 macOS）。**还没在 Mac 上跑过。**
- [ ] `ios/Qingke`：App 壳（下面的设计）
- [ ] `ios/project.yml`（XcodeGen）+ `.github/workflows/ios.yml`（macOS runner：核心测试、模拟器构建、模拟器启动截图、无签名 ipa）
- [ ] App 图标（由 `www/icon.svg` 渲染，iOS 需要直角满版 1024px PNG）

## 壳的设计（已定，待实现）

| Android | iOS 做法 |
| --- | --- |
| `https://qingke.local` + `shouldInterceptRequest` | `WKURLSchemeHandler`，自定义 scheme `qingke-app://app/`，只读 bundle 里的 `www/`，带同样的 CSP / nosniff / no-store 头 |
| `addJavascriptInterface` 同步调用 | `WKUserScript`（documentStart、仅主框架）注入 `window.Android` 垫片：同步 getter（`getNotificationStatus`、`getShareEntrySettings`、`consumeShareLink`）读 JS 侧缓存，原生推送更新；其余方法 `postMessage` 到原生白名单 |
| `evaluateJavascript` 回调 + 20 次重试 | 同样的 dispatch + 250ms 重试；PDF 仍然分 192KB 块传 |
| AlarmManager 滚动精确闹钟 | `UNCalendarNotificationTrigger`（浮动本地时间，自动适配时区变化）。iOS 每个 App 最多 64 条待发通知：只排最近 62 条提醒 + 1 条「打开清课续排」提示；前台和 `BGAppRefreshTask` 时补排。`exact` 恒为 true |
| 课程状态常驻通知 | 第一版不做；以后用 Live Activity（需 Widget 扩展） |
| 后台/自启动设置、应用内更新 | iOS 不适用，不注入对应方法，网页会显示「需要 Android 安装版」（之后可按 `platform` 调文案） |
| 教务网页 WebView | 全屏 VC + 独立 WKWebView，不挂桥；同样的地址校验、桌面版切换（`preferredContentMode`）、`target=_blank` 收回同一页、同一段「导入此页」抓取脚本 |
| 备份/PDF 选择 | `UIDocumentPickerViewController`（导出用 `forExporting`，导入限 5MB / 20MB 并校验 JSON / `%PDF-`） |
| 分享链接 `qingke://share` / `https://qk.sagiri.org/s` | URL scheme 直接可用；Universal Link 需要付费开发者账号 + 服务器 `apple-app-site-association` |
| 剪贴板识别 | 只在 `changeCount` 变化且 `detectPatterns(.probableWebURL)` 命中时才读，减少 iOS 的粘贴提示 |
| — | **localStorage 镜像**：iOS 在存储紧张时可能清掉 WKWebView 数据。垫片拦截 `qingke.*` 键的写入同步到 App 沙盒文件；启动时若 localStorage 里一个 `qingke.*` 键都没有而镜像有，就整体恢复 |

## 构建与安装（不需要 Mac）

GitHub Actions 的 macOS runner 编译出无签名 `.ipa`，Windows 上用 Sideloadly + 免费 Apple ID 装到 iPhone（7 天重签一次）。
要上架或长期分发需要 Apple Developer 账号（$99/年），届时再加签名和 TestFlight。
