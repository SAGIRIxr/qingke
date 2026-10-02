# 清课 Android 外壳

无第三方 Android 运行时依赖的 Java + WebView 应用，包名 `cn.qingke.app`，最低 Android 8.0（API 26），当前 `compileSdk` / `targetSdk` 为 35。

## 本机构建

已验证环境：Java 21、Android SDK 35、Gradle 8.11.1、Android Gradle Plugin 8.7.3。SDK 位置由 `ANDROID_HOME`／`ANDROID_SDK_ROOT` 或构建参数指定，不依赖开发者的个人目录。

在项目根目录运行：

```powershell
.\scripts\build-android.ps1 -Offline
```

首次配置其他电脑时去掉 `-Offline` 以下载构建依赖；可使用 `-SdkPath`、`-GradlePath` 参数指定 SDK 和 Gradle，也可使用环境变量与 PATH。脚本只构建，不会安装或操作手机。默认生成已签名的 `dist\qingke-3.1.0-release.apk`；本地开发可加 `-Configuration Debug`。正式构建须先配置下述私有签名。Gradle `preBuild` 会把 `www` 同步至生成的 `android/app/src/main/assets/www`，不要直接编辑该生成目录。

项目路径含中文，因此配置了 `android.overridePathCheck=true`。当前 Windows 环境已通过资源及 Java 编译；若其他工具链无法处理该路径，可将整个项目复制至纯英文路径再构建。

## 原生与网页约定

仅本地课表页面 `https://qingke.local/index.html` 能调用下列桥接接口；该来源由原生读取随 APK 打包的资源，不会进行 DNS 或网络请求。

| 原生接口 | 行为 |
| --- | --- |
| `Android.getVersion()` | 同步返回版本字符串 |
| `Android.openSchool(url)` | 打开独立教务 WebView，只接受 HTTP / HTTPS 地址 |
| `Android.exportBackup(json)` | 通过系统文件选择器原样保存字符串，限制 5 MB；也允许导出损坏的 JSON 原文用于后续找回数据 |
| `Android.importBackup()` | 通过系统文件选择器读取 JSON 对象，限制 5 MB |
| `Android.importPdf()` | 通过系统文件选择器读取 PDF，限制 20 MB；不会上传文件 |
| `Android.syncSchedule(json)` | 原子替换本地通知计划、撤销旧闹钟和通知，再安排下一时间节点 |
| `Android.getNotificationStatus()` | 同步返回 JSON 字符串 `{granted,exact,enabled,ongoing,remindersAllowed,statusAllowed}` |
| `Android.requestNotifications()` | 用户主动开启功能后调用，Android 13+ 申请通知权限 |
| `Android.openExactAlarmSettings()` | 用户点击后打开精确提醒系统授权页，Android 12 以下无需额外授权 |
| `Android.openNotificationSettings()` | 打开应用通知设置，包括课前提醒和状态两个频道 |
| `Android.testNotification()` | 立即发送一条 60 秒后自动消失的测试通知；不会自行请求权限 |
| `Android.shareRequest(requestId, action, baseUrl, payloadJson)` | 仅允许 `create/get/update/delete` 分享操作，后台 HTTPS 请求用户配置的服务器；本地页面网络 CSP 不放宽 |
| `Android.consumeShareLink()` | 取出一条待确认分享，返回 JSON 字符串 `{code,server,source,id}`；无记录返回空字符串。`source` 为 `link` 或 `clipboard`，`id` 为规范化分享内容的 SHA-256 |
| `Android.getShareEntrySettings()` | 返回 JSON 字符串 `{clipboardEnabled}`，剪贴板分享识别默认开启 |
| `Android.setClipboardShareEnabled(enabled)` | 保存开关；关闭时丢弃原生待处理的剪贴板建议，显式链接不受影响 |
| `Android.shareText(text)` / `Android.copyText(text)` | 用户主动点击后调用系统文本分享选择器或复制；最多 16384 个字符。返回 boolean 表示参数通过并交给 UI 线程，系统操作失败由原生提示 |
| `Android.getUpdateStatus()` | 同步返回版本、更新阶段、下载进度、安装来源授权及已校验包状态 |
| `Android.checkForUpdate(requestId, proxyBase)` | 检查固定 GitHub 项目的 `update.json`；代理空字符串为直连 |
| `Android.downloadUpdate(requestId)` | 下载最近一次原生校验过的更新；不接受网页传入的 URL 或文件路径 |
| `Android.cancelUpdate()` | 取消当前检查／下载，并取消待继续安装意图 |
| `Android.installUpdate()` | 再次校验缓存 APK 后打开系统安装确认；必要时先申请未知来源安装授权 |

| 网页回调 | 参数 / 约定 |
| --- | --- |
| `window.onSchoolCapture(payload)` | 对象 `{url, title, html, text, framesSkipped}`，网页负责识别、预览与最终确认 |
| `window.onBackupLoaded(json)` | JSON 字符串，网页负责格式校验和恢复确认 |
| `window.onBackupSaved(true)` | 可选，文件确实写入成功才触发 |
| `window.onPdfLoaded(payload)` | 对象 `{name,base64}`，网页用随包附带的 PDF.js 本地解析和预览 |
| `window.onPdfError(payload)` | 对象 `{message}`，读取失败时告知原因 |
| `window.onNotificationStatus(status)` | 授权后、回到应用时及同步计划后更新通知状态 |
| `window.onShareLinkAvailable()` | 仅通知有待处理分享，不带剪贴板原文。网页注册回调后也应主动调用 `consumeShareLink()`，已有编辑表单时自行暂存待确认项 |
| `window.onAppUpdateEvent(event)` | 更新事件；`type` 为 `checking/available/latest/progress/downloaded/verifying/installing/permission/cancelled/error/status`，携带当前 `phase`、`busy`、`manifest` 与字节进度 |
| `window.onScheduleSyncError(payload)` | 对象 `{message}`，计划校验或存储失败，旧有效计划继续保留 |
| `window.onShareResult(result)` | 对象 `{requestId,ok,status,data?,message?}`；使用 requestId 与原请求配对 |
| `window.onNativeBack()` | 可选，返回 `true` 表示网页已关闭弹窗或处理返回；否则应用退至后台 |

文件选择取消不会触发导入、导出成功回调，也不会改变课表。导出保留传入原文，不以 JSON 校验阻止损坏数据留存；恢复入口仍严格校验 JSON 对象，网页继续校验课表数据结构。读取错误显示原生提示，失败内容不会传入网页。导入回调会短暂等待网页模块初始化。JSON 读取和写入在后台线程执行。导出选择器打开期间若系统终止应用进程，需要返回课表重新导出；待导出的内容不写入额外缓存文件。

## 教务页面与本地数据

本地课表 WebView 与教务 WebView 是不同实例。教务 WebView 没有 `Android` JavaScript 接口；本地 WebView 仅能加载应用资源，CSP 只允许本地来源连接和 Worker（用于 PDF 字体、CMap 与解析），禁止外部网络、第三方 iframe 和内联脚本。资源拦截器仍拒绝所有非 `qingke.local` 请求，不需要 `unsafe-eval`。文件访问及 `file://` 跨域访问均禁用。SSL 证书错误始终取消，不提供忽略错误按钮。

用户在教务浏览器内自行登录。点击「导入此页」时，原生读取页面的清理后 DOM 和文字，保留正方课表需要的表格、class/id/title 及非敏感 data 属性；移除脚本、表单输入及疑似密码/token/cookie/session 属性。不会读取密码输入内容、Cookie API 或登录请求。捕获网址去掉查询参数和片段。

登录会话由 Android WebView 自身保存，用于再次进入教务系统；这些 Cookie 不进入课表备份。课表存储在本地 WebView 的 localStorage，卸载或清除应用数据会删除课表与会话。请使用 JSON 导出保留课表。本应用未启用 Android 系统云备份。

## 通知计划与权限

通知计划单独保存在应用私有 `SharedPreferences`，包含课程名、地点、毫秒时间戳和小节，不包含教务账号、密码或会话。网页必须先应用作息、调课和停课规则，再提交实际发生的课程列表。每次 `syncSchedule` 是完整替换，不是追加：

```json
{
  "enabled": true,
  "ongoing": false,
  "minutes": 10,
  "breakReminder": false,
  "statusMode": "remaining",
  "events": [
    {
      "id": "stable-occurrence-id",
      "name": "高等数学",
      "location": "A101",
      "start": 1790985600000,
      "end": 1790991600000,
      "segments": [
        {"start": 1790985600000, "end": 1790988300000},
        {"start": 1790988900000, "end": 1790991600000}
      ]
    }
  ]
}
```

`enabled` 控制课前/课间提醒，`ongoing` 独立控制课程状态。默认提前量为 10 分钟，支持 0–120 分钟；`breakReminder` 只在实际存在课间后提醒继续上课。`statusMode` 可选 `remaining`（默认倒计时）或 `elapsed`（上课时累计授课时间，扣除课间）。事件标识须唯一，起止为 epoch 毫秒，小节排序后必须覆盖课程的首尾且互不重叠。最多接受 12000 次课程、每次 40 个小节；无 `segments` 时视为一段连续课程。

只安排一个下一关键时间的 `AlarmManager` 闹钟，接收后安排后续节点；应用退到后台或普通进程被系统回收仍能调度，无常驻服务、无每秒唤醒。开机、系统时间/时区变化、包更新和精确闹钟授权后会重排。时区变化时保留课表的本地钟表时间。设置关闭或传入空列表会撤销旧通知和闹钟。Android 的“强行停止”会禁用闹钟，需重新打开应用。

状态卡只在课前窗口至结束之间显示。收起和展开布局都在正文内放置系统 Chronometer，收起内容高度 44 dp，避免依赖厂商模板可能隐藏的标题时间栏；授课、休息和继续授课分别更新。计时基准使用 `SystemClock.elapsedRealtime()`，不通过进程每秒刷新通知，无新增定时唤醒。标准标题和正文保留有数字的“更新时”快照与准确结束钟点，供忽略自定义视图的系统界面及无障碍读取。课间即使设置累计模式也显示继续上课倒计时，并冻结累计授课时间；下一小节继续累计且排除休息。通知可见性设为私密，锁屏按系统设置隐藏课程详情。Android 14 用户可划掉大多数持续通知，应用不强制阻止。状态卡在当前段结束自动过期，避免系统延迟时留下负计时或过期课程。

考试使用相同事件接口，加 `type:"exam"`（兼容 `kind:"exam"` 或 `exam:` ID 前缀），直接给出起止毫秒时间戳。省略小节时整场视为连续时段，通知显示“考试中”“距考试结束”等考试措辞。

首次打开、升级和同步课表均不申请通知权限。用户开启后前端调用授权接口。Android 12+ 未授权精确提醒时用非精确闹钟降级，`exact:false` 明确告知前端；省电模式、厂商后台限制及非精确模式可能延迟。用户撤销精确权限时系统会停止应用并清除精确闹钟，重新打开后改用降级模式。两个通知频道被单独关闭时可用 `remindersAllowed` / `statusAllowed` 提示。

运行纯 Java 调度验证（无需模拟器）：

```powershell
.\android\test-notifications.ps1
```

脚本覆盖 205 项断言：35 项调度检查、18 项通知展示检查、27 项分享网络边界检查、77 项分享入口与剪贴板检查、42 项更新安全检查及 6 项更新生命周期检查。分享入口检查包括协议与参数白名单、规范化口令、无效编码、剪贴板消息中多个不同链接拒绝、重复识别与进程恢复、显式链接优先、队列上限、关闭开关与本应用复制内容去重。更新检查包括固定仓库与资源路径、HTTPS 代理、重定向越界、证书集合、降级／重放／调试包拒绝、流式下载大小、位篡改、提前结束及取消。生命周期测试用真实 executor 和锁存器重现 Activity 销毁时任务／deadline 提交被拒绝的交错，保证不会出现未捕获线程异常。其他检查覆盖小节与课间边界、两开关独立、重启去重、elapsedRealtime 基准、考试文案、受控 PUT 与 UTF-8 限额。已发送提醒标识随当前学期计划保留；移动课程后的新时间可正常提醒。

2026-10-02 小米真机验证：收起的课程状态通知正文确实显示秒级倒计时（截图从 `00:39` 变为 `00:31`）；保持前台的短课程在课间显示「课间休息／距继续上课 00:28」，下一小节切回下课倒计时；累计模式在实际经过 61 秒、其中休息 30 秒的测试中显示「累计授课 00:31」。系统权限返回时刷新权限区域并保留表单内尚未保存的 17 分钟提前量；测试后恢复真实课表与通知计划。展开布局、长时间 Doze／后台送达、设备重启后送达及实际 PDF 文件选择器仍未完成真机验证。

短于一分钟的连串节点可能受到 [`setExactAndAllowWhileIdle` 的系统频率限制](https://developer.android.com/reference/android/app/AlarmManager#setExactAndAllowWhileIdle(int,%20long,%20android.app.PendingIntent))；状态卡在当前节点结束失效，系统延迟可能出现暂时空窗。首次手机状态不稳定时未拍到课间卡，随后稳定前台复测及持久化 `next` 核对已显示正常过界，没有据此增加未经验证的双闹钟策略。

通知实现参考：[Android 闹钟](https://developer.android.com/develop/background-work/services/alarms)、[通知运行时权限](https://developer.android.com/develop/ui/compose/notifications/notification-permission)、[系统 Chronometer](https://developer.android.com/reference/android/app/Notification.Builder#setChronometerCountDown(boolean))。

### 生命周期审查记录

- `enabled=false, ongoing=true`：仍安排课程状态节点，提醒列表为空；纯 Java 检查覆盖两开关独立。
- `syncSchedule`：先完整校验再写入，取消唯一旧 `PendingIntent`、清空旧通知和待触发边界，随后根据新计划重排；已排队的旧广播只会读取新计划，不能携带旧课程内容发送。
- Activity 恢复与闹钟同时到时：两条入口通过同一个同步锁串行执行；恢复会消费已经到时的持久化边界，避免重排时跳过提醒。先持久化已发送标识再展示，防止重复广播、重启或时钟回拨补发同一提醒。
- 通知权限缺失时保留课程计划并停止安排通知；用户授权返回、开机及应用恢复时重新检查权限。缺少精确闹钟权限时降级为非精确；系统强行停止或撤销精确权限后需要重新打开恢复调度。
- 时区变更同步转换课程、小节和已发送标识，保留当地钟表时间；状态通知随转换后的课程更新。本应用目前没有独立于手机时区的“校园时区”设置。
- PDF.js 使用 6.3.289 legacy 同源模块和 Worker，解析设置已关闭 Eval/WASM/字体注入；[官方兼容表](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported)规定 legacy 支持 Chrome 125+。本次手机 WebView 133 已通过中文 PDF 本地解析与预览回调验证；Android 文件选择器用户选取仍待实际文件验证。

- 权限页面显示旧状态的代码原因：原生在 `onResume` 实时读取并回调权限，前端回调原先只替换变量，没有刷新已打开弹窗。原生另补获得窗口焦点时回调，覆盖只切换焦点的厂商设置浮层；前端需要更新权限区域并保留未保存表单。
- 原状态通知只设置标准模板的 `setUsesChronometer`，正文完全没有剩余数值；已改成两种尺寸的正文 Chronometer 和标准文字回退。新版收起正文已在小米真机验证，展开布局仍待实测。

自定义通知参考：[官方布局与高度限制](https://developer.android.com/develop/ui/views/notifications/custom-notification)、[RemoteViews 计时器](https://developer.android.com/reference/android/widget/RemoteViews)。

## 分享链接、系统分享与剪贴板

3.2 新增两种外部入口：`https://qk.sagiri.org/s#code=<口令>&server=<编码后的HTTPS根地址>` 与 `qingke://share?code=<口令>&server=<编码后的HTTPS根地址>`。口令是 20 位 Crockford 字符，可带连字符并规范成大写；两个参数必须齐全且各出现一次，不接受其他操作、凭据、路径或参数。整条链接最多 2048 字符，服务器沿用下述 HTTPS 根地址校验，不会改变应用默认分享服务器。

Manifest 为 HTTPS `/s` 单独声明自动验证 App Link，为自定义协议单独声明过滤器；实际接收仍再次严格校验 `ACTION_VIEW` 与 URI。`singleTop` 顶部实例通过 `onNewIntent` 接收，未强制清空系统返回栈；冷启动始终加载随包的本地页面。外部 Intent 的 extras、选择器和剪贴板数据都不作为操作指令，链接也不会直接加载到本地或教务 WebView。可信页面 ready、处于前台并有焦点后通知网页；教务页打开时暂存到返回课表页面。待确认队列最多 8 项、显式链接优先；保存实例状态时保留未消费项，已消费的启动链接不重放。网页负责保护编辑草稿，用户点击读取后才能联网与预览，导入另行确认。[Android 深链文档](https://developer.android.com/training/app-links/deep-linking)、[Activity 返回栈规则](https://developer.android.com/guide/components/activities/tasks-and-back-stack)。

剪贴板识别默认开启，可在应用设置中关闭。只在可信课表页面前台获得焦点时读取一次单项纯文本，最多 16384 字符，不轮询、不调用 `coerceToText`、不访问剪贴板 URI；教务 WebView 打开时不读取。识别严格匹配的分享链接，普通文本与多个不同分享链接的消息都忽略。全文不进入 JavaScript、不上传、不写日志；原生私有设置只记录最近 32 个规范化分享的 SHA-256 指纹，因此拒绝后不会在后续打开应用时反复提示同一记录。显式链接唤起的当次前台跳过旧剪贴板，本应用复制或发送的分享也记为已识别。系统分享使用 `ACTION_SEND`、`text/plain` 与系统 chooser，发送目标由用户选择。[系统分享说明](https://developer.android.com/develop/ui/compose/sharing/send)、[系统剪贴板 API](https://developer.android.com/reference/android/content/ClipboardManager)。

本轮 77 项纯 Java 入口测试通过；App Link 域名关联、手机冷／暖启动、系统分享界面和系统剪贴板提示的实测记录以 [TESTING.md](TESTING.md) 为准，不能由策略测试代替。

## 分享网络桥接

`baseUrl` 必须是用户配置的 HTTPS 主机根地址，可带端口，不得包含账号、密码、查询、片段或其他路径，长度最多 500 字符。原生只拼接 `/api/shares` 与 `/api/shares/{20位分享码}`，没有任意 URL、路径、Header 或 HTTP 方法入口：

| action | 固定请求 | payload |
| --- | --- | --- |
| `create` | `POST /api/shares` | `{format:"qingke-semester",version:1,semester,includeNotes:false,includeExams:false,expiresInDays:7}` |
| `get` | `GET /api/shares/{code}` | `{code}` |
| `update` | `PUT /api/shares/{code}` | `{code,deleteToken,...sharePayload,allowFollow,expectedRevision}`；令牌仅放在 Bearer Header，body 剥除 code/deleteToken |
| `delete` | `DELETE /api/shares/{code}` | `{code,deleteToken}`，删除令牌只放在 `Authorization: Bearer …` |

创建和更新都允许 `allowFollow`、`includeExams` 布尔值（默认 false），`expiresInDays` 原生接受 1–365 天，服务器进一步执行普通分享最长 30 天、允许跟随的分享最长 365 天。PUT 可省略有效期，原生也不补默认值，保留服务端原到期日；显式传天数才续期。更新必须提供正整数 `expectedRevision`，HTTP 409 冲突原样回调给前端拉取差异预览；`revision` 等服务返回字段透传。服务端嵌套 `error.message` 提取为中文错误提示。分享更新仅在用户使用前台功能时请求，不增加后台服务或定时网络任务。

创建请求体限 1 MB（按 UTF-8 字节），所有响应限 2 MB（同时检查 Content-Length 和实际流）。只接受 JSON 对象响应，不执行服务端脚本。连接超时 10 秒、读超时 15 秒、总期限 40 秒，禁止任何重定向，使用系统正常 TLS 和主机名校验，不复制教务 Cookie。最多两条并发与两条排队请求，相同 requestId 不重复提交；其他过量请求返回 429。本地文件、教务登录状态及通知计划不会自动上传，分享内容由前端确认后传入；前端负责按 includeNotes 选项裁剪学期对象。

关闭 Activity 时中断队列、断开连接并清除回调引用，不保留 Activity。回调 `status:0` 表示本地校验或无法连接；HTTP 错误保留实际 status，message 限 300 字符。响应及错误日志不打印删除令牌、请求体或带凭据 URL。浏览器页面仍受 `connect-src 'self'` 约束，网络仅由此目的限定的原生桥接执行。[HTTPS 连接 API](https://developer.android.com/reference/javax/net/ssl/HttpsURLConnection)

2026-10-02 真机原生桥接对部署服务验证 create `201`、get `200`、update `200`、旧 revision 更新 `409`、delete `204`；明确勾选的考试内容可以往返，PUT 省略 `expiresInDays` 保留原到期时间。测试分享已撤销，未改变用户真实课表。

## 已知限制

- 校园内网、校外 VPN、验证码和学校统一认证仍由学校控制，应用不绕过这些步骤。
- 只能读取当前页面及同源 iframe；跨域 iframe 会计入 `framesSkipped`。应尽量直接打开完整课表页面。
- 画布绘制、图片课表、仅含 PDF 的页面无法通过 DOM 识别。页面过大时仅捕获前 250 万 HTML 字符和 100 万文字字符。
- 为兼容旧教务系统允许 HTTP，并在浏览器提示中标识；HTTPS 页面禁止加载不安全的混合资源。这可能使部分老旧页面需要学校修复。
- 不支持打开第三方应用协议、下载课表附件、证书异常站点，以及要求第三方 Cookie 的嵌入式登录。常见顶层登录跳转和用户点击的新窗口链接可在独立教务浏览器内继续。
- 当前版本为单 Activity，本地数据不会因切换横竖屏而重载。后台进程被系统终止后重新打开时，课表从 localStorage 恢复，教务浏览位置需要重新进入。

## 调试与发行

`debug` 构建开启 `WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)`，方便通过 USB / ADB 的 Chrome DevTools 检查页面。不要把调试版本当作正式发行包。

`release` 构建的 `BuildConfig.DEBUG` 为 `false`，关闭 WebView 调试及网页控制台日志。3.1.0 的 `versionCode` 为 4。为直接覆盖现有 1.x–3.0 测试安装，正式构建继续使用**原安装证书对应的同一私钥**；证书主题仍为历史的 Android Debug，不代表 release 允许调试。没有生成另一把密钥或要求卸载迁移。Android 覆盖更新要求签名身份兼容，见 [官方签名说明](https://developer.android.com/studio/publish/app-signing)。

公开证书 SHA-256：`3a7b3de62c96fbb3dd5f5eb26c02bfe88efa1de88b09175cf83a58fb3a2641b9`。本机已把原私钥导入工作区外的 PKCS#12 签名库，采用随机强口令；配置中的口令由 Windows DPAPI 绑定当前系统账号保护，目录仅当前账号与 SYSTEM 可访问，原 debug keystore 保持原样。私钥、签名库及口令不进入源码仓库或 Release 附件。

Gradle 通过 `QINGKE_STORE_FILE`、`QINGKE_STORE_PASSWORD`、`QINGKE_KEY_ALIAS`、`QINGKE_KEY_PASSWORD` 读取签名配置。PowerShell 构建脚本也支持 `-SigningConfigPath`，默认查找当前 Windows 用户 `%LOCALAPPDATA%/Qingke/signing/local-signing.json`，仅在子构建期间解密并设置环境变量，完成后恢复原环境。私有配置包含 `storeFile`、`keyAlias`、`passwordDpapi`，不要放入项目目录。其他机器可用私有环境变量配置；无需也不应把本机 DPAPI 文件上传到 GitHub。没有签名时 release 构建直接失败，构建脚本还会核对产物证书指纹，防止错误密钥生成无法覆盖的 APK。

公开 CI 可运行 `assembleDebug` 验证编译，产生的开发者自有签名不得作为官方更新发布。官方发布包由持有原证书的本机执行 `build-android.ps1 -Configuration Release` 构建。签名库应另行安全备份；DPAPI 配置不能直接在另一 Windows 账号下解密。

## 应用内更新

设置中的「应用更新」调用固定仓库 `SAGIRIxr/qingke`。清单固定为 `https://github.com/SAGIRIxr/qingke/releases/latest/download/update.json`，资源 URL 根据严格校验的版本、tag 和文件名重新生成，不接受清单中的任意下载 URL。GitHub 的 `latest/download` 为[官方发布资源链接格式](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)。

```json
{
  "format": "qingke-update",
  "version": 1,
  "packageName": "cn.qingke.app",
  "versionCode": 4,
  "versionName": "3.1.0",
  "tag": "v3.1.0",
  "asset": "qingke-3.1.0-release.apk",
  "size": 12345678,
  "sha256": "填写实际文件的64位十六进制SHA256",
  "notes": "本次更新说明"
}
```

上例大小与摘要仅为格式示意，发布时由实际 release APK 生成。清单最多 64 KiB，说明最多 4000 字符，APK 最多 128 MiB；清单必须精确匹配包内版本和声明大小。下载使用有界流读，校验 SHA-256，再由 Android `getPackageArchiveInfo` 读取并验证签名，要求包名相同、版本号严格增加、非 debuggable、当前签名证书集合完全相同。安装前对缓存重新校验，系统安装器仍保留最终确认。[PackageManager API](https://developer.android.com/reference/android/content/pm/PackageManager)、[AOSP 证书校验实现](https://android.googlesource.com/platform/frameworks/base.git/+/bb0845d30a38194f82d582cd512eb68a74e294f5/core/java/android/content/pm/PackageManager.java)。

默认下载连接为第三方 [GHFast](https://ghfast.top/)，可关闭代理或设置 HTTPS 根域前缀。2026-10-02 对公开 Git 官方仓库的同一文件分别直连、经 GHFast 与 GH-Proxy 读取，三路均为 200 且 SHA-256 相同；这只是当时可用性检查，不保证代理长期可用。代理不是更新信任根，不能绕过 APK 的本地证书校验。代理配置独立保存在 `qingke.updates.v1`，不发送到教务或课表分享服务。

连接／读取超时分别为 15／25 秒，检查总时限 60 秒，下载总时限 15 分钟；重定向最多 5 次，目标仅允许该项目固定发布路径、相同代理下的该路径或 GitHub 官方发布 CDN。网络只携带固定 User-Agent／Accept，不读取 WebView Cookie，不放宽本地 CSP。单次仅运行一项检查、下载或安装核验；Activity 销毁会停止未完成操作，已验证包保留在应用私有存储中。

安装包通过 `exported=false`、只读 URI 授权的专用 ContentProvider 交给安装器，仅可访问 SHA-256 命名的更新 APK，不暴露其他应用文件。Android 8+ 未允许「安装未知应用」时先打开清课的系统授权页，返回后可继续已请求的安装；不会静默安装或申请其他应用的安装权限。[未知来源授权 API](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls())。

当前纯 Java 更新安全验证通过；实际 GitHub 清单检测、下载进度和系统安装确认以 [TESTING.md](TESTING.md) 的后续真机记录为准，不能用单元测试替代完整升级验证。

安全与文件 API 参考：[Android WebView 原生桥接](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)、[Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files)。
