# 清课口令分享服务

Python 3.11+ 标准库 SQLite / WSGI 应用。生产运行使用独立虚拟环境中的 Gunicorn 26.2.0，并且仅监听 `127.0.0.1:8787`；外网访问必须经过用户配置的 HTTPS 反向代理。服务提供口令分享 API、清课静态主页和分享链接落地页，不提供教务代理、登录、文件上传或目录浏览。

## 主页与分享落地页

固定静态路由为 `/`、`/s`、`/site.css`、`/site.js`、`/site-config.js`、`/share-link.js`、`/icon.svg` 和 `/.well-known/assetlinks.json`，只接受 GET / HEAD。文件映射明确列出，请求路径不会直接拼接到磁盘路径。静态页面独立于 API 的 Origin 检查与配额，访问官网不会消耗创建、读取等分享额度；已有 API 的校验、限速和缓存规则保持独立。

主页以 `site/site-config.js` 集中维护发布版本与固定下载来源。更新版本时只修改 `RELEASE.version`，对应 GitHub Release 中的 `qingke-X.Y.Z-release.apk`；正式 APK 可用后再部署页面。下载按钮分别直达固定项目的官方资源和 GH-Proxy 前缀，没有接受用户指定 URL 的下载或重定向接口。主页课表示意完全虚构，页面没有统计、外部字体或第三方脚本。

分享链接格式：

```text
https://qk.sagiri.org/s#code=0123456789ABCDEFGHJK&server=https%3A%2F%2Fqk.sagiri.org
```

口令和服务地址在 URL fragment 中，浏览器请求 `/s` 时不会发送片段。网页只接受一份 20 位 Crockford 口令和一个 HTTPS 根地址，用文本节点显示规范化后的服务域名；不请求 `/api/shares`，也不预览课表。不要把口令改成查询参数或路径。复制分享消息包含完整链接及分组口令，供清课打开后在用户确认时继续导入。

用户点击「打开清课」后才尝试唤起：Android 使用固定包 `cn.qingke.app` 的 `intent://share?...#Intent;scheme=qingke;package=cn.qingke.app;...;end`，其他浏览器使用 `qingke://share?...`。Chrome fallback 固定为 `https://qk.sagiri.org/s?fallback=1#...`，不会再次自动唤起。页面只在未切到后台时延时显示手动操作提示，不能据此判断应用是否安装；pagehide / visibilitychange 会取消提示计时。微信内提示改用浏览器打开。不自动下载 APK，也不自动读取剪贴板。

`/.well-known/assetlinks.json` 绑定包 `cn.qingke.app` 与已有公开签名证书，不能替换为本机另签的证书。原生 App Link 是否生效仍需正式 HTTPS 部署后由 Android 验证。页面统一返回严格 CSP（`connect-src 'none'`、不允许内联脚本和嵌入框架）、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`；不设置 Cookie。

## 接口

创建：`POST /api/shares`，`Content-Type: application/json`。

```json
{
  "format": "qingke-semester",
  "version": 1,
  "semester": { "说明": "下述单学期格式，此处仅为占位" },
  "includeNotes": false,
  "includeExams": false,
  "allowFollow": false,
  "expiresInDays": 7
}
```

成功返回 HTTP 201：`{"code":"20位口令","deleteToken":"43字符管理令牌","expiresAt":"2026-10-09T00:00:00Z","revision":1,"allowFollow":false,"updatedAt":"2026-10-02T00:00:00Z"}`。口令用密码学随机数生成，20 位 Crockford Base32，100 bit 熵；管理令牌独立随机 256 bit。两者在数据库里均只保存 SHA-256 哈希。管理令牌字段沿用 deleteToken，同时用于更新和撤销；只在创建响应中出现，客户端应仅在本机“我的分享”记录保存，不能放入课表、分享口令文字或链接中。

读取：`GET /api/shares/{code}`，返回 HTTP 200 的 `{format,version,semester,expiresAt,revision,allowFollow,updatedAt}`。口令不区分大小写，可包含用于阅读的连字符。不存在、已过期、已撤销均为 404。

更新：`PUT /api/shares/{code}`，请求头 `Authorization: Bearer <deleteToken>`；请求为完整创建 payload，额外必须提供 `expectedRevision`。成功 HTTP 200 返回 `{revision,allowFollow,expiresAt,updatedAt}`。事务内校验管理令牌与当前版本并执行 CAS，版本每次加一；版本不符返回 409 conflict，客户端应先读取并核对，不得自动覆盖。PUT 仍按 includeNotes / includeExams 过滤。省略 expiresInDays 保留已有到期时间；显式提供则从更新时刻续期。关闭 allowFollow 时保留静态副本，并将剩余有效期收敛到最多 30 天。已到期的分享不能续期，需要重新创建。

跟随更新需要发布者 allowFollow 和接收者本机选择都为 true。服务只提供快照及递增版本，不主动推送；接收端应在前台按节流读取，遇到关闭跟随、过期或撤销时停止更新并保留本地课表。对本地手动修改的处理由客户端预览与选择决定。

撤销：`DELETE /api/shares/{code}`，请求头 `Authorization: Bearer <deleteToken>`；成功 HTTP 204。错误令牌与不存在均为 404。读取口令不能更新或撤销分享。

健康检查：`GET /healthz` 返回 `{"ok":true}`，供本机使用，无需反代。

本版不支持幂等创建；客户端不得自动重试 POST。响应丢失时创建的分享会按设置自动过期；再次点击发布会创建另一份分享。

错误统一是 `{ "error": {"code":"invalid_payload","message":"中文说明"}, "requestId":"随机标识" }`。

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | invalid_payload / invalid_request | 格式、字段、引用或协议无效 |
| 403 | forbidden | Origin / CORS 预检不在允许范围 |
| 404 | not_found | 口令失效、接口不存在或撤销令牌无效 |
| 405 | method_not_allowed | 方法错误 |
| 409 | conflict | expectedRevision 与云端版本不一致 |
| 411 | length_required | 缺少 Content-Length |
| 413 | payload_too_large | 请求超过 1 MiB |
| 415 | unsupported_media_type | 请求不是 JSON |
| 429 | rate_limited | 超过速率限制，附 Retry-After 秒数 |
| 503 | storage_full / temporarily_unavailable | 存储容量满或暂不可用 |
| 500 | internal_error | 其他服务错误 |

## 单学期白名单

采用清课 v2 的单个 semester，不接受完整备份或 preferences。服务重新构造数据；未知字段拒绝。顶层字段：`id,name,startDate,totalWeeks,showWeekend,profiles,courses,dayRules,exceptions,holidayLabels,exams`。

- `profiles[]`：`id,name,effectiveFrom,periods[]`；生效日期为每年 `MM-DD`。节次为 `start,end,group`，group 是 morning / afternoon / evening。1–30 套作息，每套 1–24 节，时间递增且不重叠。
- `courses[]`：`id,name,shortName,color,assessment,nature,note,sessions[]`。最多 500 门；每门最多 100 条安排，全学期最多 5000 条。
- `sessions[]`：`id,day,startPeriod,endPeriod,weeks,teacher,location,breakMode`。breakMode 为 normal / continuous；节次限所有方案共同存在的范围。输入可以有 importSource，但始终丢弃，导出不会携带来源文件名或网页元数据。
- `dayRules[]`：`id,date,type,label,sourceDate?`，type 为 off / replace。最多 500 条，校验日期与补课来源，拒绝连锁补课。
- `exceptions[]`：`id,sessionId,sourceDate,type,date?,startPeriod?,endPeriod?,location?,teacher?,note?`，type 为 cancel / move / modify。最多 3000 条，引用须对应有效上课安排。
- `holidayLabels[]`：`id,date,name`，最多 500 条。
- `exams[]`：`id,name,date,startTime,endTime,location,note,courseId?`，最多 500 条，起止时间递增。仅 includeExams 为 true 时保留；默认输出空数组。
- 所有 `note` 默认去除或置空，只有 includeNotes 严格为 true 才保留。客户端应在发送前也做同样过滤，让未选择的数据不离开手机。调课说明 label、假日名称属于课表内容，会随分享保留，用户应在预览中核对。

开学日期可为任意星期；首周沿用周一至周日边界，实际开学前的基础安排不可作为调课来源。所有编号须唯一，字符串/数组有固定上限；拒绝 JSON 重复键、非有限数字、未知字段与无效 UTF-8。

## 限制与安全边界

静态分享默认有效期 7 天，可选 1–30 天；allowFollow 为 true 时默认 180 天，可选 1–365 天。每 300 秒自动清理过期数据，创建/更新时也清理。读取即时校验到期时间，不受清理间隔影响。最多 5000 份有效分享、100 MiB 有效内容，SQLite 主库最大 200 MiB，回滚日志受单次事务影响且提交后删除；启用 secure_delete 和渐进回收。数据库和目录权限分别 0600 / 0700。课表内容本身是服务器可读取的明文，不是端到端加密；服务器管理员属于信任边界。

限速由单个 Gunicorn worker 内存统一执行：每 IP 总请求 120/分钟，读取 60/分钟且 300/小时，创建 12/小时，更新 60/小时，撤销 30/分钟；全局 600/分钟、创建 200/小时、更新 600/小时。限速桶最多 10000，重启或 worker 回收会重置计数。生产配置固定 1 个 worker、8 线程，不可直接增加 worker 数绕过统一限速。上游还可加反代限流及网络防护；应用限速不能替代运营商的分布式攻击防护。

程序默认 Origin 只允许 `https://qingke.local`；本次部署环境文件精确允许 `https://qingke.local` 和用户的 `https://qk.sagiri.org`。环境变量可精确追加使用中的网页预览源，禁止 `*` 或 null。无 Origin 的原生/CLI 请求允许。来源校验只负责浏览器访问约束，持有 100 bit 口令才是读取凭证，Origin 不作为身份认证。无 cookie 会话，不返回 Access-Control-Allow-Credentials。

只有显式设置 `QINGKE_TRUST_PROXY=true` 且 TCP 来源为 loopback 时才信任单条 `X-Real-IP`，不接受地址链、不信任 X-Forwarded-For；反代必须覆盖该请求头。CORS 允许 Content-Type / Authorization，API 缓存与 MIME 嗅探关闭；API 响应只为 JSON。客户端仍须使用 textContent 或 HTML 转义渲染分享内字符串，不能直接 innerHTML；服务不会通过删除尖括号破坏课程名称。

日志不记录口令、令牌、课表或请求完整 URL。Gunicorn access log 关闭，应用错误只记录随机 requestId 和固定错误类别。提供的 nginx location 关闭访问日志与可能携带 URL 的错误日志；若使用 CDN/WAF，也应关闭或遮蔽 /api/shares 路径与 Authorization 的记录。

## 测试与本地运行

```sh
python3 -m unittest discover -s server/tests -v
node --test server/tests/site-links.test.mjs
python3 server/share_server.py --dev --port 8787 --db /tmp/qingke-test.sqlite3
```

开发服务器只绑定 loopback，不能作为公网部署入口。Python 官方明确将内置 HTTP 服务定位为基本功能；生产使用 Gunicorn 处理 HTTP 协议，并通过 nginx 缓冲请求体、限制大小和读取超时。

## Debian 12 部署

下面命令需要管理员权限；代码归 root，不给服务用户修改权限。

```sh
apt-get install --no-install-recommends python3-venv
useradd --system --home /var/lib/qingke-share --shell /usr/sbin/nologin qingke-share
install -d -m 0755 /opt/qingke-share
install -d -o qingke-share -g qingke-share -m 0700 /var/lib/qingke-share
install -m 0644 share_server.py share_schema.py gunicorn.conf.py /opt/qingke-share/
install -d -m 0755 /opt/qingke-share/site
install -m 0644 site/*.html site/*.css site/*.js site/*.svg site/*.json /opt/qingke-share/site/
install -m 0644 requirements.txt /opt/qingke-share/
python3 -m venv /opt/qingke-share/.venv
/opt/qingke-share/.venv/bin/pip install --require-hashes --only-binary=:all: -r /opt/qingke-share/requirements.txt
install -m 0640 qingke-share.env.example /etc/qingke-share.env
install -m 0644 qingke-share.service /etc/systemd/system/qingke-share.service
systemctl daemon-reload
systemctl enable --now qingke-share
curl --fail http://127.0.0.1:8787/healthz
```

使用已有服务用户时不要重复 useradd。如果配置文件已有内容，先核对再改，不直接覆盖。`nginx-location.conf.example` 是已有 API 的 location 片段，不应替换整份 nginx 配置；启用官网还需把上述固定静态路由送到同一上游，并允许 GET / HEAD。独立官网域名可把完整路径交给后端，由后端的固定映射拒绝其他资源；不要用目录 alias 暴露源码或数据库。修改后执行 nginx -t 再由用户重载。不要将 8787 端口映射到公网。

### Lucky 反向代理

本次用户选择域名 `qk.sagiri.org`，Lucky 与服务运行在同一宿主机网络。将该域名 HTTPS 入口的上游设置为 `http://127.0.0.1:8787`，保留完整请求路径（API 路径、`/`、`/s`、静态资源和 `/.well-known/assetlinks.json`）以及 POST / GET / HEAD / PUT / DELETE / OPTIONS 方法。`/s?fallback=1` 需原样透传；URL 的 `#` 片段由浏览器保留，不参与反代。配置域名 DNS 与 TLS 证书后才能在手机填写 `https://qk.sagiri.org`。

关闭响应缓存、请求/访问日志，以及任何记录完整 URL、Authorization 或请求体的调试日志；避免跨域重定向，勿将 API 路径改写到首页。允许 Content-Type、Authorization、Origin 及 CORS 预检请求头透传；不要在代理层加入 `Access-Control-Allow-Origin: *`。尽可能在 Lucky 设置 1 MiB 请求体上限、约 15 秒请求超时和请求体缓冲。若提供请求头设置，应删除 Cookie、X-Forwarded-For，并把 X-Real-IP **覆盖**为实际网络来源地址，不得直接沿用客户端提供的值。

当前 `QINGKE_TRUST_PROXY=false`，Lucky 的覆盖行为经实际请求验证后才能启用；应用因此不会信任伪造的 X-Real-IP。未启用前，所有经 Lucky 的请求共用 loopback 的限速额度，这能保护服务，但多人同时使用可能较早触发限速；不要仅为绕过限速启用未验证的代理头。确认覆盖后编辑环境变量并重启 qingke-share 即可，不需要改变应用数据。

Debian 12 自带 Gunicorn 20.1 在核对时仍有已知 HTTP 协议解析问题，因此固定使用官方 PyPI wheel 并校验 SHA-256，不替换系统 Python。后续升级应先核对安全公告、更新固定版本与哈希，再重跑接口测试。

参考：[Python sqlite3 参数占位符](https://docs.python.org/3/library/sqlite3.html)、[Python HTTP 服务的生产限制](https://docs.python.org/3/library/http.server.html)、[OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)、[Debian Gunicorn 安全追踪](https://security-tracker.debian.org/tracker/source-package/gunicorn)、[Gunicorn 官方 PyPI](https://pypi.org/project/gunicorn/)。
