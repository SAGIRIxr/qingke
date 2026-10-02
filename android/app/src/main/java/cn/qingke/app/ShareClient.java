package cn.qingke.app;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLException;

/** Narrow HTTPS sharing transport. Never references WebView cookies or accepts arbitrary headers/paths. */
final class ShareClient {
    interface Listener { void onResult(JSONObject result); }
    private volatile Listener listener;
    private volatile boolean closed;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> requestIds = ConcurrentHashMap.newKeySet();
    private final Set<HttpsURLConnection> connections = ConcurrentHashMap.newKeySet();
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(2), runnable -> new Thread(runnable, "qingke-share"));
    private final ScheduledThreadPoolExecutor deadline = new ScheduledThreadPoolExecutor(1,
            runnable -> new Thread(runnable, "qingke-share-deadline"));

    ShareClient(Listener listener) {
        this.listener = listener;
        executor.allowCoreThreadTimeOut(true);
        deadline.setKeepAliveTime(30, TimeUnit.SECONDS);
        deadline.allowCoreThreadTimeOut(true);
        deadline.setRemoveOnCancelPolicy(true);
    }

    void request(String requestId, String action, String baseUrl, String payloadJson) {
        if (closed) return;
        if (requestId == null || !requestId.matches("[A-Za-z0-9_.:-]{1,100}")) {
            deliver(result(requestId, false, 0, null, "请求标识无效"));
            return;
        }
        final JSONObject payload;
        final String endpoint, method, authorization;
        final byte[] body;
        try {
            ShareRequestPolicy.requestBytes(payloadJson);
            payload = new JSONObject(payloadJson);
            endpoint = ShareRequestPolicy.endpoint(baseUrl, action, payload.optString("code", ""));
            method = ShareRequestPolicy.method(action);
            boolean update = "update".equals(action);
            authorization = ("delete".equals(action) || update) ? ShareRequestPolicy.bearer(payload.optString("deleteToken", "")) : null;
            if ("create".equals(action) || update) {
                if (!"qingke-semester".equals(payload.optString("format")) || payload.optInt("version") != 1
                        || payload.optJSONObject("semester") == null || !(payload.opt("includeNotes") instanceof Boolean)
                        || (payload.has("includeExams") && !(payload.opt("includeExams") instanceof Boolean))
                        || (payload.has("allowFollow") && !(payload.opt("allowFollow") instanceof Boolean))
                        || ((!update || payload.has("expiresInDays")) && (payload.optInt("expiresInDays") < 1 || payload.optInt("expiresInDays") > 365))
                        || (update && payload.optInt("expectedRevision", 0) < 1))
                    throw new IllegalArgumentException("分享内容格式不正确");
                // Rebuild the envelope so unknown caller-supplied headers/paths/tokens cannot leak.
                JSONObject envelope = new JSONObject().put("format", "qingke-semester").put("version", 1)
                        .put("semester", payload.getJSONObject("semester")).put("includeNotes", payload.getBoolean("includeNotes"))
                        .put("includeExams", payload.optBoolean("includeExams", false))
                        .put("allowFollow", payload.optBoolean("allowFollow", false));
                if (payload.has("expiresInDays")) envelope.put("expiresInDays", payload.getInt("expiresInDays"));
                if (update) envelope.put("expectedRevision", payload.getInt("expectedRevision"));
                body = ShareRequestPolicy.requestBytes(envelope.toString());
            } else body = null;
        } catch (JSONException | IllegalArgumentException error) {
            deliver(result(requestId, false, 0, null, error.getMessage()));
            return;
        }
        if (!requestIds.add(requestId)) {
            // A retried bridge call with the same ID shares the original result, not a second POST.
            return;
        }
        try {
            executor.execute(() -> {
                try { perform(requestId, endpoint, method, authorization, body); }
                finally { requestIds.remove(requestId); }
            });
        } catch (RejectedExecutionException error) {
            requestIds.remove(requestId);
            deliver(result(requestId, false, 429, null, "正在处理其他分享请求，请稍后重试"));
        }
    }

    private void perform(String id, String endpoint, String method, String authorization, byte[] body) {
        if (closed) return;
        HttpsURLConnection connection = null;
        java.util.concurrent.ScheduledFuture<?> timeout = null;
        int status = 0;
        try {
            connection = (HttpsURLConnection) new URL(endpoint).openConnection();
            final HttpsURLConnection active = connection;
            connections.add(active);
            if (closed) return;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(15_000);
            connection.setUseCaches(false);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "Qingke-Share/1");
            // Never copy WebView cookies. Default TLS/hostname verification remains enabled.
            if (authorization != null) connection.setRequestProperty("Authorization", authorization);
            timeout = deadline.schedule(active::disconnect, 40, TimeUnit.SECONDS);
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            }
            status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new IOException("分享服务器发生重定向，请填写最终 HTTPS 地址");
            long size = connection.getContentLengthLong();
            if (size > ShareRequestPolicy.MAX_RESPONSE_BYTES) throw new IOException("服务器响应超过 2 MB");
            JSONObject data = null;
            try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                if (input != null) {
                    byte[] bytes = ShareRequestPolicy.readBounded(input);
                    if (bytes.length > 0) data = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                }
            }
            boolean ok = status >= 200 && status < 300;
            String message = null;
            if (!ok) {
                JSONObject error = data == null ? null : data.optJSONObject("error");
                message = error != null ? error.optString("message", "服务器返回 " + status)
                        : data != null ? data.optString("message", data.optString("error", "服务器返回 " + status)) : "服务器返回 " + status;
            }
            deliver(result(id, ok, status, data, message));
        } catch (SSLException error) {
            deliver(result(id, false, status, null, "分享服务器证书验证失败，请检查地址与系统时间"));
        } catch (SocketTimeoutException error) {
            deliver(result(id, false, status, null, "分享请求超时，请检查网络后重试"));
        } catch (JSONException error) {
            deliver(result(id, false, status, null, "分享服务器返回的内容不是有效 JSON"));
        } catch (IOException | IllegalArgumentException | RejectedExecutionException error) {
            // Do not include exception URLs, tokens or payloads in the UI/logs.
            String message = error.getMessage();
            if (message == null || !(message.startsWith("分享服务器发生重定向") || message.startsWith("服务器响应超过")))
                message = "无法连接分享服务器，请检查地址与网络后重试";
            deliver(result(id, false, status, null, message));
        } finally {
            if (timeout != null) timeout.cancel(false);
            if (connection != null) { connections.remove(connection); connection.disconnect(); }
        }
    }

    private static JSONObject result(String id, boolean ok, int status, JSONObject data, String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("requestId", id == null ? "" : id).put("ok", ok).put("status", status);
            if (data != null) result.put("data", data);
            if (message != null) result.put("message", message.substring(0, Math.min(300, message.length())));
        } catch (JSONException ignored) { }
        return result;
    }

    private void deliver(JSONObject result) {
        if (closed) return;
        main.post(() -> {
            Listener current = listener;
            if (!closed && current != null) current.onResult(result);
        });
    }

    void close() {
        closed = true;
        listener = null;
        executor.shutdownNow();
        deadline.shutdownNow();
        for (HttpsURLConnection connection : connections) connection.disconnect();
        connections.clear();
        requestIds.clear();
    }
}
