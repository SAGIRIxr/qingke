package cn.qingke.app;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.inputmethod.EditorInfo;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** The trusted timetable and untrusted campus browser never share a JavaScript bridge. */
public final class MainActivity extends Activity {
    private static final String APP_HOST = "qingke.local";
    private static final String APP_URL = "https://" + APP_HOST + "/index.html";
    private static final int EXPORT_BACKUP = 101;
    private static final int IMPORT_BACKUP = 102;
    private static final int WEB_FILE = 103;
    private static final int IMPORT_PDF = 104;
    private static final int NOTIFICATION_PERMISSION = 105;
    private static final int MAX_BACKUP_BYTES = 5 * 1024 * 1024;
    private static final int MAX_PDF_BYTES = 20 * 1024 * 1024;
    private static final int BG = Color.rgb(246, 247, 242);
    private static final int INK = Color.rgb(38, 62, 53);
    private static final int ACCENT = Color.rgb(36, 74, 64);
    private FrameLayout root;
    private WebView appWeb;
    private WebView schoolWeb;
    private LinearLayout schoolPanel;
    private EditText address;
    private TextView browserHint;
    private ProgressBar progress;
    private Button captureButton;
    private String pendingBackup;
    private int documentRequest;
    private ValueCallback<Uri[]> fileCallback;
    private boolean desktopMode;
    private String mobileUserAgent;
    private ShareClient shareClient;
    private UpdateClient updateClient;
    private final ShareEntryInbox shareEntries = new ShareEntryInbox();
    private SharedPreferences shareEntryPreferences;
    private volatile boolean entryPageReady, entryForeground, entryHasFocus, entrySchoolOpen, entryDestroyed;
    private boolean clipboardCheckedForFocus, skipClipboardUntilPause;
    private String handledShareIntentId = "";

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        shareEntryPreferences = getSharedPreferences("share-entry", MODE_PRIVATE);
        shareEntries.restoreRecent(shareEntryPreferences.getString("recentHashes", ""));
        if (savedInstanceState != null) {
            handledShareIntentId = savedInstanceState.getString("handledShareIntent", "");
            skipClipboardUntilPause = savedInstanceState.getBoolean("skipShareClipboard", false);
            shareEntries.restorePending(savedInstanceState.getStringArray("pendingShareUrls"),
                    savedInstanceState.getStringArray("pendingShareSources"), clipboardShareEnabled());
        }
        acceptShareIntent(getIntent(), true);
        shareClient = new ShareClient(result -> dispatch("onShareResult", result.toString()));
        updateClient = new UpdateClient(this, new UpdateClient.Listener() {
            @Override public void onEvent(JSONObject event) { dispatch("onAppUpdateEvent", event.toString()); }
            @Override public void onInstallPermissionNeeded() {
                openSettings(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            }
            @Override public void onInstallReady(Uri uri) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent.setClipData(android.content.ClipData.newRawUri("清课更新", uri));
                    startActivity(intent);
                } catch (ActivityNotFoundException error) { toast("无法打开系统安装器，请稍后重试"); }
            }
        });
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
        configureInsets();
        appWeb = new WebView(this);
        appWeb.setBackgroundColor(BG);
        configureAppWebView();
        root.addView(appWeb, new FrameLayout.LayoutParams(-1, -1));
        appWeb.loadUrl(APP_URL);
    }

    private void configureInsets() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return insets;
            });
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void safeSettings(WebView web) {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSafeBrowsingEnabled(true);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
    }

    @SuppressLint("AddJavascriptInterface")
    private void configureAppWebView() {
        safeSettings(appWeb);
        appWeb.getSettings().setTextZoom(100);
        appWeb.addJavascriptInterface(new NativeBridge(), "Android");
        appWeb.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return appResource(request);
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAppUrl(request.getUrl()) || !"/index.html".equals(request.getUrl().getPath());
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { entryPageReady = false; }
            @Override public void onPageFinished(WebView view, String url) {
                entryPageReady = APP_URL.equals(url);
                notifyShareEntry();
                readShareClipboardOnFocus();
            }
        });
        appWeb.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                if (BuildConfig.DEBUG) Log.d("QingkeWeb", message.message() + " @ " + message.lineNumber());
                return true;
            }

            @Override public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), WEB_FILE);
                } catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    toast("未找到文件选择器");
                }
                return true;
            }
        });
    }

    private static boolean isAppUrl(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme()) && APP_HOST.equalsIgnoreCase(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private WebResourceResponse appResource(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!isAppUrl(uri) || !"GET".equals(request.getMethod())) return deniedResource();
        String path = uri.getPath();
        if (path == null || path.contains("..") || path.contains("\\")) return deniedResource();
        if ("/".equals(path)) path = "/index.html";
        try {
            InputStream stream = getAssets().open("www" + path);
            String mime = (path.endsWith(".js") || path.endsWith(".mjs")) ? "text/javascript" : path.endsWith(".css") ? "text/css"
                    : path.endsWith(".json") ? "application/json" : path.endsWith(".svg") ? "image/svg+xml"
                    : path.endsWith(".png") ? "image/png" : path.endsWith(".woff2") ? "font/woff2"
                    : path.endsWith(".wasm") ? "application/wasm"
                    : (path.endsWith(".bcmap") || path.endsWith(".pfb") || path.endsWith(".ttf")) ? "application/octet-stream" : "text/html";
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream);
        } catch (IOException error) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
        }
    }

    private static WebResourceResponse deniedResource() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, new ByteArrayInputStream(new byte[0]));
    }

    public final class NativeBridge {
        @JavascriptInterface public String getVersion() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public String consumeShareLink() {
            if (!entryPageReady || !entryForeground || !entryHasFocus || entrySchoolOpen || entryDestroyed) return "";
            ShareEntryInbox.Entry entry = shareEntries.poll();
            while (entry != null && "clipboard".equals(entry.source) && !clipboardShareEnabled()) entry = shareEntries.poll();
            if (entry == null) return "";
            try { return new JSONObject().put("code", entry.link.code).put("server", entry.link.server)
                    .put("source", entry.source).put("id", entry.link.id).toString(); }
            catch (JSONException impossible) { return ""; }
        }
        @JavascriptInterface public String getShareEntrySettings() {
            return "{\"clipboardEnabled\":" + clipboardShareEnabled() + "}";
        }
        @JavascriptInterface public void setClipboardShareEnabled(boolean enabled) {
            shareEntryPreferences.edit().putBoolean("clipboardEnabled", enabled).apply();
            if (!enabled) shareEntries.dropClipboard();
        }
        @JavascriptInterface public boolean shareText(String text) {
            if (!ShareEntryPolicy.validText(text)) return false;
            runOnUiThread(() -> {
                if (entryDestroyed || isFinishing()) return;
                try {
                    rememberOwnShareText(text);
                    Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
                    startActivity(Intent.createChooser(send, "分享课表"));
                } catch (ActivityNotFoundException | SecurityException error) { toast("无法打开系统分享，请尝试复制链接"); }
            });
            return true;
        }
        @JavascriptInterface public boolean copyText(String text) {
            if (!ShareEntryPolicy.validText(text)) return false;
            runOnUiThread(() -> {
                if (entryDestroyed || isFinishing()) return;
                try {
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (clipboard == null) { toast("无法使用系统剪贴板"); return; }
                    clipboard.setPrimaryClip(ClipData.newPlainText("清课分享", text));
                    rememberOwnShareText(text);
                } catch (SecurityException error) { toast("系统暂不允许复制，请稍后重试"); }
            });
            return true;
        }
        @JavascriptInterface public String getUpdateStatus() { UpdateClient client=updateClient;return client==null?"{}":client.status().toString(); }
        @JavascriptInterface public void checkForUpdate(String requestId,String proxyBase) { UpdateClient client=updateClient;if(client!=null)client.check(requestId,proxyBase); }
        @JavascriptInterface public void downloadUpdate(String requestId) { UpdateClient client=updateClient;if(client!=null)client.download(requestId); }
        @JavascriptInterface public void cancelUpdate() { UpdateClient client=updateClient;if(client!=null)client.cancel(); }
        @JavascriptInterface public void installUpdate() { UpdateClient client=updateClient;if(client!=null)client.install(); }
        @JavascriptInterface public void openSchool(String url) { runOnUiThread(() -> showSchool(url)); }
        @JavascriptInterface public void exportBackup(String json) { runOnUiThread(() -> chooseBackupDestination(json)); }
        @JavascriptInterface public void importBackup() { runOnUiThread(MainActivity.this::chooseBackupSource); }
        @JavascriptInterface public void importPdf() { runOnUiThread(MainActivity.this::choosePdfSource); }
        @JavascriptInterface public void shareRequest(String requestId, String action, String baseUrl, String payloadJson) {
            ShareClient client = shareClient;
            if (client != null) client.request(requestId, action, baseUrl, payloadJson);
        }
        @JavascriptInterface public String getNotificationStatus() { return ScheduleNotifications.getStatus(MainActivity.this); }
        @JavascriptInterface public void syncSchedule(String json) {
            try {
                ScheduleNotifications.sync(MainActivity.this, json);
                runOnUiThread(MainActivity.this::dispatchNotificationStatus);
            } catch (JSONException | IllegalArgumentException error) {
                runOnUiThread(() -> dispatch("onScheduleSyncError", "{\"message\":" + JSONObject.quote(error.getMessage()) + "}"));
            }
        }
        @JavascriptInterface public void requestNotifications() { runOnUiThread(MainActivity.this::requestNotificationPermission); }
        @JavascriptInterface public void openExactAlarmSettings() { runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 31) openSettings(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getPackageName())));
            else dispatchNotificationStatus();
        }); }
        @JavascriptInterface public void openNotificationSettings() { runOnUiThread(() -> openSettings(
                new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()))); }
        @JavascriptInterface public void testNotification() { runOnUiThread(() -> {
            if (!ScheduleNotifications.granted(MainActivity.this)) toast("请先允许清课发送通知");
            else ScheduleNotifications.test(MainActivity.this);
            dispatchNotificationStatus();
        }); }
    }

    private boolean clipboardShareEnabled() { return shareEntryPreferences.getBoolean("clipboardEnabled", true); }

    private void persistShareEntryHashes() {
        shareEntryPreferences.edit().putString("recentHashes", shareEntries.recentState()).apply();
    }

    private void rememberOwnShareText(String text) {
        // Copying our own share must not suggest importing it when the chooser closes.
        shareEntries.remember(ShareEntryPolicy.fromClipboard(text));
        persistShareEntryHashes();
    }

    private void acceptShareIntent(Intent intent, boolean restoring) {
        // Do not access extras, selectors, clip data, flags, or any externally supplied operation.
        ShareEntryPolicy.Link link = intent == null ? null : ShareEntryPolicy.fromIntent(intent.getAction(), intent.getDataString());
        if (link != null && !(restoring && link.id.equals(handledShareIntentId))) {
            handledShareIntentId = link.id;
            skipClipboardUntilPause = true;
            if (shareEntries.offer(link, "link")) persistShareEntryHashes();
            notifyShareEntry();
        }
        // A recreation must not replay the original external URL after the user has consumed it.
        setIntent(new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN));
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        acceptShareIntent(intent, false);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        ShareEntryInbox.Entry[] entries = shareEntries.snapshot();
        String[] urls = new String[entries.length], sources = new String[entries.length];
        for (int i = 0; i < entries.length; i++) { urls[i] = entries[i].link.url(); sources[i] = entries[i].source; }
        state.putStringArray("pendingShareUrls", urls);
        state.putStringArray("pendingShareSources", sources);
        state.putString("handledShareIntent", handledShareIntentId);
        state.putBoolean("skipShareClipboard", skipClipboardUntilPause);
        super.onSaveInstanceState(state);
    }

    private void notifyShareEntry() {
        if (!entryPageReady || !entryForeground || !entryHasFocus || entrySchoolOpen || entryDestroyed || !shareEntries.hasPending()) return;
        // The payload stays native until the local UI is ready to open (or queue) its confirmation form.
        dispatch("onShareLinkAvailable", "");
    }

    private void readShareClipboardOnFocus() {
        if (!entryPageReady || !entryForeground || !entryHasFocus || entrySchoolOpen || entryDestroyed || clipboardCheckedForFocus) return;
        clipboardCheckedForFocus = true;
        if (!clipboardShareEnabled() || skipClipboardUntilPause || shareEntries.hasExplicit()) return;
        try {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            ClipData clip = clipboard == null ? null : clipboard.getPrimaryClip();
            if (clip == null || clip.getItemCount() != 1) return;
            // getText only: never coerceToText, open a clipboard content URI, or expose arbitrary text to JS.
            CharSequence text = clip.getItemAt(0).getText();
            ShareEntryPolicy.Link link = ShareEntryPolicy.fromClipboard(text);
            if (link != null && shareEntries.offer(link, "clipboard")) {
                persistShareEntryHashes();
                notifyShareEntry();
            }
        } catch (SecurityException | IllegalStateException ignored) { /* OS clipboard policy remains authoritative. */ }
    }

    private void requestNotificationPermission() {
        ScheduleNotifications.createChannels(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
        else dispatchNotificationStatus();
    }

    private void openSettings(Intent intent) {
        try { startActivity(intent); }
        catch (ActivityNotFoundException error) { toast("无法打开系统设置，请从应用信息中检查权限"); }
    }

    private void dispatchNotificationStatus() { dispatch("onNotificationStatus", ScheduleNotifications.getStatus(this)); }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION) {
            ScheduleNotifications.refresh(this, false);
            dispatchNotificationStatus();
        }
    }

    private static String validSchoolUrl(String raw) {
        if (raw == null) return null;
        String url = raw.trim();
        if (url.length() > 4096 || url.matches(".*[\\s\\p{Cntrl}].*")) return null;
        if (!url.contains("://")) url = "https://" + url;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                || uri.getHost() == null || uri.getHost().isEmpty() || uri.getUserInfo() != null || APP_HOST.equalsIgnoreCase(uri.getHost())) return null;
        return url;
    }

    private void showSchool(String rawUrl) {
        String url = validSchoolUrl(rawUrl);
        if (url == null) { toast("请输入有效的 http 或 https 教务网址"); return; }
        closeSchool();
        entrySchoolOpen = true;
        schoolPanel = new LinearLayout(this);
        schoolPanel.setOrientation(LinearLayout.VERTICAL);
        schoolPanel.setBackgroundColor(BG);

        LinearLayout toolbar = row();
        toolbar.setPadding(dp(6), dp(4), dp(6), 0);
        Button close = smallButton("返回");
        close.setOnClickListener(view -> closeSchool());
        toolbar.addView(close, new LinearLayout.LayoutParams(dp(62), dp(46)));
        address = new EditText(this);
        address.setSingleLine(true);
        address.setTextSize(13);
        address.setTextColor(INK);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setSelectAllOnFocus(true);
        address.setText(url);
        address.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) { navigateSchool(address.getText().toString()); return true; }
            return false;
        });
        toolbar.addView(address, new LinearLayout.LayoutParams(0, dp(46), 1));
        Button refresh = smallButton("刷新");
        refresh.setOnClickListener(view -> schoolWeb.reload());
        toolbar.addView(refresh, new LinearLayout.LayoutParams(dp(62), dp(46)));
        schoolPanel.addView(toolbar);

        LinearLayout actions = row();
        actions.setPadding(dp(14), 0, dp(10), dp(4));
        Button back = smallButton("上一页");
        back.setOnClickListener(view -> { if (schoolWeb.canGoBack()) schoolWeb.goBack(); });
        actions.addView(back, new LinearLayout.LayoutParams(dp(74), dp(42)));
        Button desktop = smallButton("电脑版");
        desktop.setOnClickListener(view -> {
            desktopMode = !desktopMode;
            desktop.setText(desktopMode ? "手机版" : "电脑版");
            schoolWeb.getSettings().setUserAgentString(desktopMode
                    ? mobileUserAgent.replace("; wv", "").replace("Android", "Linux").replace("Mobile", "Desktop") : mobileUserAgent);
            schoolWeb.reload();
        });
        actions.addView(desktop, new LinearLayout.LayoutParams(dp(74), dp(42)));
        View spacer = new View(this);
        actions.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1));
        captureButton = smallButton("导入此页");
        captureButton.setTextColor(ACCENT);
        captureButton.setOnClickListener(view -> captureSchool());
        actions.addView(captureButton, new LinearLayout.LayoutParams(dp(100), dp(42)));
        schoolPanel.addView(actions);

        browserHint = new TextView(this);
        browserHint.setTextSize(11);
        browserHint.setTextColor(Color.rgb(111, 118, 137));
        browserHint.setPadding(dp(18), 0, dp(18), dp(9));
        browserHint.setText("自行登录并打开本学期课表，再点「导入此页」");
        schoolPanel.addView(browserHint);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        schoolPanel.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));

        schoolWeb = new WebView(this);
        safeSettings(schoolWeb);
        schoolWeb.setBackgroundColor(Color.WHITE);
        schoolWeb.getSettings().setBuiltInZoomControls(true);
        schoolWeb.getSettings().setDisplayZoomControls(false);
        schoolWeb.getSettings().setUseWideViewPort(true);
        schoolWeb.getSettings().setLoadWithOverviewMode(true);
        schoolWeb.getSettings().setSupportMultipleWindows(true);
        mobileUserAgent = schoolWeb.getSettings().getUserAgentString();
        desktopMode = false;
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(schoolWeb, false);
        schoolWeb.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                boolean invalid = validSchoolUrl(request.getUrl().toString()) == null;
                if (invalid && request.isForMainFrame()) toast("此链接不能在教务导入页打开");
                return invalid;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) return null;
                return deniedResource();
            }
            @Override public void onPageStarted(WebView view, String pageUrl, android.graphics.Bitmap icon) {
                if (address != null && !address.hasFocus()) address.setText(safeDisplayUrl(pageUrl));
                if (browserHint != null) browserHint.setText(pageUrl.startsWith("http:")
                        ? "此网站使用 HTTP；登录前请核对学校域名。进入课表后可导入。"
                        : "自行登录并打开本学期课表，再点「导入此页」");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && browserHint != null) browserHint.setText("页面未能打开，请检查网址和校园网 / VPN 后刷新。");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                if (browserHint != null) browserHint.setText("网站证书校验失败，已停止连接。请联系学校或检查系统时间。");
            }
        });
        schoolWeb.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                if (progress != null) { progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE); }
            }
            @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean userGesture, android.os.Message resultMsg) {
                if (!userGesture) return false;
                // Route user-initiated target=_blank links into the same isolated browser.
                final WebView popup = new WebView(MainActivity.this);
                safeSettings(popup);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                        String destination = validSchoolUrl(request.getUrl().toString());
                        if (destination != null && schoolWeb != null) schoolWeb.loadUrl(destination);
                        popup.destroy();
                        return true;
                    }
                });
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        schoolPanel.addView(schoolWeb, new LinearLayout.LayoutParams(-1, 0, 1));
        root.addView(schoolPanel, new FrameLayout.LayoutParams(-1, -1));
        appWeb.setVisibility(View.GONE);
        schoolWeb.requestFocus();
        schoolWeb.loadUrl(url);
    }

    private static String safeDisplayUrl(String url) {
        Uri parsed = Uri.parse(url);
        return parsed.buildUpon().clearQuery().fragment(null).build().toString();
    }

    private void navigateSchool(String raw) {
        String url = validSchoolUrl(raw);
        if (url == null) { toast("请输入有效的 http 或 https 教务网址"); return; }
        schoolWeb.requestFocus();
        android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        keyboard.hideSoftInputFromWindow(address.getWindowToken(), 0);
        schoolWeb.loadUrl(url);
    }

    private void captureSchool() {
        if (schoolWeb == null) return;
        captureButton.setEnabled(false);
        captureButton.setText("读取中…");
        // Work on detached clones only. Credentials, form values, scripts, URL tokens and cookies are never collected.
        String script = "(function(){try{var parts=[],texts=[],seen=0,skipped=0;"
                + "function read(doc,depth){if(!doc||!doc.body||depth>4||seen++>20)return;"
                + "var copy=doc.body.cloneNode(true);"
                + "copy.querySelectorAll('script,style,link,meta,input,textarea,select,button,iframe,frame,object,embed,svg,canvas,noscript').forEach(function(n){n.remove()});"
                + "copy.querySelectorAll('*').forEach(function(n){Array.from(n.attributes).forEach(function(a){var safeData=a.name.indexOf('data-')===0&&!/(pass|pwd|secret|token|cookie|auth|session|credential)/i.test(a.name);if(['colspan','rowspan','class','id','title'].indexOf(a.name)<0&&!safeData)n.removeAttribute(a.name)});if(n.tagName==='BR')n.replaceWith(doc.createTextNode('\\n'));if(/^(P|DIV|TR|LI|SECTION|H[1-6])$/.test(n.tagName))n.appendChild(doc.createTextNode('\\n'));if(/^(TD|TH)$/.test(n.tagName))n.appendChild(doc.createTextNode('\\t'))});"
                + "parts.push(copy.innerHTML);texts.push(copy.textContent||'');"
                + "doc.querySelectorAll('iframe,frame').forEach(function(f){try{if(f.contentDocument)read(f.contentDocument,depth+1);else skipped++}catch(e){skipped++}})}"
                + "read(document,0);return JSON.stringify({url:location.origin+location.pathname,title:document.title,html:parts.join('\\n').slice(0,2500000),text:texts.join('\\n').slice(0,1000000),framesSkipped:skipped});"
                + "}catch(e){return JSON.stringify({error:'无法读取当前页面，请进入课表页面后重试。'})}})()";
        final WebView source = schoolWeb;
        source.evaluateJavascript(script, value -> {
            if (source != schoolWeb || schoolWeb == null) return;
            captureButton.setEnabled(true);
            captureButton.setText("导入此页");
            try {
                Object decoded = new JSONTokener(value).nextValue();
                if (!(decoded instanceof String)) throw new JSONException("Empty page");
                JSONObject capture = new JSONObject((String) decoded);
                if (capture.has("error")) { toast(capture.getString("error")); return; }
                if (capture.optString("text").trim().isEmpty() && capture.optString("html").trim().isEmpty()) {
                    toast("页面内容为空，请打开完整课表后重试"); return;
                }
                closeSchool();
                dispatch("onSchoolCapture", capture.toString());
            } catch (JSONException error) { toast("读取失败，请等待课表加载完成后重试"); }
        });
    }

    private void closeSchool() {
        if (schoolPanel != null) root.removeView(schoolPanel);
        if (schoolWeb != null) {
            if (schoolPanel != null) schoolPanel.removeView(schoolWeb);
            schoolWeb.stopLoading();
            schoolWeb.loadUrl("about:blank");
            schoolWeb.destroy();
            schoolWeb = null;
        }
        schoolPanel = null;
        address = null;
        browserHint = null;
        progress = null;
        captureButton = null;
        if (appWeb != null) { appWeb.setVisibility(View.VISIBLE); appWeb.requestFocus(); }
        entrySchoolOpen = false;
        notifyShareEntry();
    }

    private void chooseBackupDestination(String json) {
        if (documentRequest != 0) { toast("请先完成当前文件选择"); return; }
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > MAX_BACKUP_BYTES) { toast("备份内容为空或过大"); return; }
        // Export preserves the exact stored text, including malformed JSON, so damaged data can be recovered later.
        // Only the restore path validates JSON before handing it to the timetable.
        pendingBackup = json;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "清课备份-" + new SimpleDateFormat("yyyyMMdd-HHmm", Locale.CHINA).format(new Date()) + ".json");
        try { documentRequest = EXPORT_BACKUP; startActivityForResult(intent, EXPORT_BACKUP); }
        catch (ActivityNotFoundException error) { documentRequest = 0; pendingBackup = null; toast("未找到文件管理器"); }
    }

    private void chooseBackupSource() {
        if (documentRequest != 0) { toast("请先完成当前文件选择"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/json", "text/plain", "application/octet-stream"});
        try { documentRequest = IMPORT_BACKUP; startActivityForResult(intent, IMPORT_BACKUP); }
        catch (ActivityNotFoundException error) { documentRequest = 0; toast("未找到文件管理器"); }
    }

    private void choosePdfSource() {
        if (documentRequest != 0) { toast("请先完成当前文件选择"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        try { documentRequest = IMPORT_PDF; startActivityForResult(intent, IMPORT_PDF); }
        catch (ActivityNotFoundException error) { documentRequest = 0; toast("未找到文件管理器"); }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == WEB_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        if (requestCode == EXPORT_BACKUP || requestCode == IMPORT_BACKUP || requestCode == IMPORT_PDF) documentRequest = 0;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            if (requestCode == EXPORT_BACKUP) pendingBackup = null;
            return;
        }
        Uri uri = data.getData();
        if (requestCode == EXPORT_BACKUP && pendingBackup != null) {
            final String backup = pendingBackup;
            pendingBackup = null;
            new Thread(() -> {
                try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) {
                    if (stream == null) throw new IOException("No output stream");
                    stream.write(backup.getBytes(StandardCharsets.UTF_8));
                    runOnUiThread(() -> { toast("备份已保存"); dispatch("onBackupSaved", "true"); });
                } catch (IOException | SecurityException | IllegalArgumentException error) { runOnUiThread(() -> toast("备份保存失败，请选择其他位置")); }
            }, "qingke-backup-write").start();
        } else if (requestCode == IMPORT_PDF) {
            new Thread(() -> {
                try (InputStream stream = getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (stream == null) throw new IOException("无法读取文件");
                    String name = "课表.pdf";
                    try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE), nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex) && cursor.getLong(sizeIndex) > MAX_PDF_BYTES) throw new IOException("PDF 超过 20 MB，请选择较小的文件");
                            if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex);
                        }
                    }
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = stream.read(buffer)) != -1) {
                        if (output.size() + count > MAX_PDF_BYTES) throw new IOException("PDF 超过 20 MB，请选择较小的文件");
                        output.write(buffer, 0, count);
                    }
                    byte[] bytes = output.toByteArray();
                    if (!new String(bytes, 0, Math.min(1024, bytes.length), StandardCharsets.ISO_8859_1).contains("%PDF-"))
                        throw new IOException("这不是有效的 PDF 文件");
                    final String pdfName = name, base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                    runOnUiThread(() -> sendPdfChunk(pdfName, base64, 0, appWeb));
                } catch (IOException | SecurityException | IllegalArgumentException error) {
                    runOnUiThread(() -> dispatch("onPdfError", "{\"message\":" + JSONObject.quote(error.getMessage()) + "}"));
                }
            }, "qingke-pdf-read").start();
        } else if (requestCode == IMPORT_BACKUP) {
            new Thread(() -> {
                try (InputStream stream = getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (stream == null) throw new IOException("No input stream");
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = stream.read(buffer)) != -1) {
                        if (output.size() + count > MAX_BACKUP_BYTES) throw new IOException("Backup too large");
                        output.write(buffer, 0, count);
                    }
                    String json = new String(output.toByteArray(), StandardCharsets.UTF_8);
                    if (json.startsWith("\uFEFF")) json = json.substring(1);
                    new JSONObject(json);
                    final String parsed = json;
                    runOnUiThread(() -> dispatch("onBackupLoaded", JSONObject.quote(parsed)));
                } catch (IOException | JSONException | SecurityException | IllegalArgumentException error) { runOnUiThread(() -> toast("无法读取备份，请选择有效的清课 JSON 文件（小于 5 MB）")); }
            }, "qingke-backup-read").start();
        }
    }

    private void sendPdfChunk(String name, String base64, int offset, WebView target) {
        if (isFinishing() || target == null || target != appWeb) return;
        int end = Math.min(base64.length(), offset + 192 * 1024);
        // Keep each JavaScript IPC bounded even for a 20 MB PDF. Only the final callback exposes the assembled data.
        String script = (offset == 0 ? "window.__qingkePdfParts=[];" : "")
                + "window.__qingkePdfParts.push(" + JSONObject.quote(base64.substring(offset, end)) + ");";
        target.evaluateJavascript(script, ignored -> {
            if (end < base64.length()) sendPdfChunk(name, base64, end, target);
            else {
                target.evaluateJavascript("window.__qingkePdfPayload={name:" + JSONObject.quote(name)
                        + ",base64:window.__qingkePdfParts.join('')};delete window.__qingkePdfParts;", ready -> {
                    dispatch("onPdfLoaded", "window.__qingkePdfPayload");
                });
            }
        });
    }

    private void dispatch(String function, String jsonArgument) {
        dispatch(function, jsonArgument, 0);
    }

    private void dispatch(String function, String jsonArgument, int attempt) {
        if (isFinishing() || appWeb == null) return;
        // A document picker may resume a freshly recreated Activity before the ES module has registered callbacks.
        final WebView target = appWeb;
        target.evaluateJavascript("(function(){if(typeof window." + function + "!=='function')return false;window." + function + "(" + jsonArgument + ");return true})()", delivered -> {
            if ("true".equals(delivered) && "onPdfLoaded".equals(function)) target.evaluateJavascript("delete window.__qingkePdfPayload", null);
            if (target != appWeb || isFinishing() || "true".equals(delivered) || "onBackupSaved".equals(function)) return;
            if (attempt < 20) target.postDelayed(() -> dispatch(function, jsonArgument, attempt + 1), 250);
            else if (!"onNotificationStatus".equals(function) && !"onScheduleSyncError".equals(function)) toast("页面尚未就绪，请重新导入");
        });
    }

    @Override public void onBackPressed() {
        if (schoolWeb != null) {
            if (schoolWeb.canGoBack()) schoolWeb.goBack(); else closeSchool();
        } else if (appWeb != null) {
            appWeb.evaluateJavascript("typeof window.onNativeBack==='function' ? !!window.onNativeBack() : false", result -> {
                if (!"true".equals(result)) moveTaskToBack(true);
            });
        } else super.onBackPressed();
    }

    @Override protected void onPause() {
        entryForeground = false;
        skipClipboardUntilPause = false;
        super.onPause();
        if (appWeb != null) appWeb.onPause();
        if (schoolWeb != null) schoolWeb.onPause();
        CookieManager.getInstance().flush();
    }

    @Override protected void onResume() {
        super.onResume();
        entryForeground = true;
        notifyShareEntry(); // onNewIntent can pause/resume without changing window focus.
        readShareClipboardOnFocus(); // Finish a focus acquisition if its callback arrived before onResume.
        if (appWeb != null) appWeb.onResume();
        if (schoolWeb != null) schoolWeb.onResume();
        ScheduleNotifications.refresh(this, false);
        dispatchNotificationStatus();
        if (updateClient != null) updateClient.resume();
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) clipboardCheckedForFocus = false;
        entryHasFocus = hasFocus;
        if (hasFocus) { notifyShareEntry(); readShareClipboardOnFocus(); }
        // Some vendor permission panels are overlays and do not pause/resume the Activity.
        if (hasFocus && appWeb != null) {
            dispatchNotificationStatus();
            if (updateClient != null) updateClient.resume();
        }
    }

    @Override protected void onDestroy() {
        entryDestroyed = true;
        if (updateClient != null) { updateClient.close(); updateClient = null; }
        if (shareClient != null) { shareClient.close(); shareClient = null; }
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        closeSchool();
        if (appWeb != null) { root.removeView(appWeb); appWeb.removeJavascriptInterface("Android"); appWeb.destroy(); appWeb = null; }
        super.onDestroy();
    }

    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        return layout;
    }

    private Button smallButton(String text) {
        Button button = new Button(this, null, android.R.attr.borderlessButtonStyle);
        button.setText(text);
        button.setTextSize(13);
        button.setTextColor(INK);
        button.setAllCaps(false);
        button.setPadding(0, 0, 0, 0);
        button.setMinimumWidth(0);
        button.setMinWidth(0);
        return button;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
}
