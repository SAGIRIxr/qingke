package cn.qingke.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** On-device reminders, independent of WebView/activity lifetime. No network or foreground service. */
final class ScheduleNotifications {
    static final String ACTION_TICK = "cn.qingke.app.SCHEDULE_TICK";
    private static final String PREFS = "qingke_notifications";
    private static final String REMINDERS = "course_reminders", STATUS = "course_status";
    private static final int ALARM_ID = 2401, STATUS_ID = 2402, REMINDER_ID = 2403, TEST_ID = 2404;
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
    static void createChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel reminders = new NotificationChannel(REMINDERS, "课前和课间提醒", NotificationManager.IMPORTANCE_HIGH);
        reminders.setDescription("显示下一节课名称、地点和上课时间");
        reminders.enableVibration(true);
        NotificationChannel status = new NotificationChannel(STATUS, "课程状态", NotificationManager.IMPORTANCE_LOW);
        status.setDescription("上课与课间倒计时，仅在课程时段显示");
        status.setSound(null, null);
        status.enableVibration(false);
        manager.createNotificationChannel(reminders);
        manager.createNotificationChannel(status);
    }
    static boolean granted(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) && context.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }
    static boolean exact(Context context) {
        return Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }
    static synchronized String getStatus(Context context) {
        JSONObject result = new JSONObject();
        try {
            JSONObject saved = new JSONObject(preferences(context).getString("schedule", "{}"));
            result.put("granted", granted(context)).put("exact", exact(context))
                    .put("enabled", saved.optBoolean("enabled")).put("ongoing", saved.optBoolean("ongoing"));
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            NotificationChannel reminder = manager.getNotificationChannel(REMINDERS);
            NotificationChannel status = manager.getNotificationChannel(STATUS);
            result.put("remindersAllowed", reminder == null || reminder.getImportance() != NotificationManager.IMPORTANCE_NONE);
            result.put("statusAllowed", status == null || status.getImportance() != NotificationManager.IMPORTANCE_NONE);
        } catch (JSONException error) { Log.w("QingkeSchedule", "Cannot read notification status"); }
        return result.toString();
    }
    static synchronized void sync(Context context, String json) throws JSONException {
        if (json == null || json.length() > 6_000_000) throw new JSONException("提醒计划过大");
        JSONObject value = new JSONObject(json);
        SchedulePlan replacement = parse(value); // Validate before touching the saved plan.
        SharedPreferences prefs = preferences(context);
        Set<String> remainingKeys = new HashSet<>();
        for (SchedulePlan.Point point : replacement.points()) if (point.type != SchedulePlan.STATE) remainingKeys.add(point.key());
        Set<String> delivered = new HashSet<>(prefs.getStringSet("delivered", Collections.emptySet()));
        delivered.retainAll(remainingKeys);
        if (!prefs.edit().putString("schedule", value.toString()).putStringSet("delivered", delivered)
                .putString("zone", ZoneId.systemDefault().getId()).remove("next").commit())
            throw new JSONException("无法保存提醒计划");
        cancelAlarm(context);
        context.getSystemService(NotificationManager.class).cancelAll();
        refresh(context, false);
    }
    private static SchedulePlan parse(JSONObject json) throws JSONException {
        JSONArray rows = json.optJSONArray("events");
        if (rows == null) rows = new JSONArray();
        if (rows.length() > 12000) throw new JSONException("提醒计划最多支持 12000 次课程");
        List<SchedulePlan.Event> events = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String id = row.getString("id"), name = row.getString("name"), location = row.optString("location", "");
            long start = row.getLong("start"), end = row.getLong("end");
            if (id.isEmpty() || id.length() > 300 || !ids.add(id) || name.isEmpty() || name.length() > 300
                    || location.length() > 500 || start < 946684800000L || end > 7258118400000L
                    || end <= start || end - start > 2 * 86400000L) throw new JSONException("课程时间或标识无效");
            List<SchedulePlan.Segment> segments = new ArrayList<>();
            JSONArray parts = row.optJSONArray("segments");
            if (parts != null) {
                if (parts.length() > 40) throw new JSONException("课程小节过多");
                for (int j = 0; j < parts.length(); j++) {
                    JSONObject part = parts.getJSONObject(j);
                    long a = part.getLong("start"), b = part.getLong("end");
                    if (a < start || b > end || b <= a) throw new JSONException("小节时间超出课程范围");
                    segments.add(new SchedulePlan.Segment(a, b));
                }
            }
            if (segments.isEmpty()) segments.add(new SchedulePlan.Segment(start, end));
            segments.sort(Comparator.comparingLong(part -> part.start));
            if (segments.get(0).start != start || segments.get(segments.size() - 1).end != end)
                throw new JSONException("课程起止时间与小节不一致");
            for (int j = 1; j < segments.size(); j++) if (segments.get(j).start < segments.get(j - 1).end)
                throw new JSONException("课程小节时间重叠");
            String type = row.optString("type", row.optString("kind", id.startsWith("exam:") ? "exam" : "course"));
            events.add(new SchedulePlan.Event(id, name, location, start, end, segments, type));
        }
        events.sort(Comparator.comparingLong(event -> event.start));
        return new SchedulePlan(json.optBoolean("enabled"), json.optBoolean("ongoing"),
                json.optBoolean("breakReminder"), json.optInt("minutes", 10), events);
    }
    static synchronized void refresh(Context context, boolean dueToAlarm) {
        createChannels(context);
        SharedPreferences prefs = preferences(context);
        try {
            JSONObject json = new JSONObject(prefs.getString("schedule", "{}"));
            adjustTimezone(json, prefs);
            SchedulePlan plan = parse(json);
            long now = System.currentTimeMillis(), scheduledAt = prefs.getLong("next", 0);
            cancelAlarm(context);
            prefs.edit().remove("next").commit();
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if ((!plan.enabled && !plan.ongoing) || !granted(context)) {
                manager.cancelAll();
                return;
            }
            // Activity resume can race the due alarm. Consume the saved due boundary here too;
            // replacements explicitly clear it, so canceled/edited schedules cannot alert.
            Set<String> delivered = new HashSet<>(prefs.getStringSet("delivered", Collections.emptySet()));
            List<SchedulePlan.Point> due = plan.remindersDue(scheduledAt, now, delivered);
            if (!due.isEmpty()) {
                for (SchedulePlan.Point point : due) delivered.add(point.key());
                // Persist before sending: duplicate broadcasts, a reboot or moving the clock back
                // must not produce a second alert for the same occurrence.
                if (prefs.edit().putStringSet("delivered", delivered).commit())
                    for (SchedulePlan.Point point : due) showReminder(context, point, now);
            }
            // Remove alerts as soon as their course ends, even if the status feature is disabled.
            for (SchedulePlan.Event event : plan.events) if (event.end <= now) manager.cancel(event.id, REMINDER_ID);
            SchedulePlan.State current = plan.stateAt(now);
            if (current == null) manager.cancel(STATUS_ID);
            else showStatus(context, current, now, "elapsed".equals(json.optString("statusMode")));
            long next = plan.nextAfter(now);
            if (next > 0) {
                prefs.edit().putLong("next", next).commit();
                AlarmManager alarms = context.getSystemService(AlarmManager.class);
                PendingIntent operation = alarmIntent(context, PendingIntent.FLAG_UPDATE_CURRENT);
                try {
                    if (exact(context)) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, operation);
                    else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, operation);
                } catch (SecurityException error) {
                    // Permission may have changed between checking it and scheduling.
                    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, operation);
                }
            }
        } catch (JSONException | IllegalArgumentException error) {
            cancelAlarm(context);
            context.getSystemService(NotificationManager.class).cancelAll();
            Log.w("QingkeSchedule", "Invalid local notification plan; waiting for next sync");
        }
    }
    private static void adjustTimezone(JSONObject json, SharedPreferences prefs) throws JSONException {
        String current = ZoneId.systemDefault().getId(), stored = prefs.getString("zone", current);
        if (current.equals(stored)) return;
        ZoneId oldZone = ZoneId.of(stored), newZone = ZoneId.of(current);
        JSONArray events = json.optJSONArray("events");
        if (events != null) for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.getJSONObject(i);
            shift(event, oldZone, newZone);
            JSONArray parts = event.optJSONArray("segments");
            if (parts != null) for (int j = 0; j < parts.length(); j++) shift(parts.getJSONObject(j), oldZone, newZone);
        }
        Set<String> shiftedDelivered = new HashSet<>();
        for (String key : prefs.getStringSet("delivered", Collections.emptySet())) {
            int separator = key.lastIndexOf('\n');
            try {
                if (separator >= 0) shiftedDelivered.add(key.substring(0, separator + 1)
                        + shiftLocalTime(Long.parseLong(key.substring(separator + 1)), oldZone, newZone));
            } catch (NumberFormatException ignored) { /* Discard corrupt deduplication metadata only. */ }
        }
        prefs.edit().putString("schedule", json.toString()).putString("zone", current)
                .putStringSet("delivered", shiftedDelivered).remove("next").commit();
    }
    private static void shift(JSONObject value, ZoneId oldZone, ZoneId newZone) throws JSONException {
        for (String key : new String[]{"start", "end"}) value.put(key, shiftLocalTime(value.getLong(key), oldZone, newZone));
    }
    private static long shiftLocalTime(long value, ZoneId oldZone, ZoneId newZone) {
        return Instant.ofEpochMilli(value).atZone(oldZone).toLocalDateTime().atZone(newZone).toInstant().toEpochMilli();
    }
    private static PendingIntent alarmIntent(Context context, int flags) {
        return PendingIntent.getBroadcast(context, ALARM_ID, new Intent(context, ScheduleReceiver.class).setAction(ACTION_TICK),
                flags | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void cancelAlarm(Context context) {
        PendingIntent old = alarmIntent(context, PendingIntent.FLAG_NO_CREATE);
        if (old != null) {
            context.getSystemService(AlarmManager.class).cancel(old);
            old.cancel();
        }
    }
    private static PendingIntent openApp(Context context) {
        return PendingIntent.getActivity(context, 0, new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static Notification.Builder base(Context context, String channel) {
        return new Notification.Builder(context, channel).setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.rgb(36, 74, 64)).setContentIntent(openApp(context))
                .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_EVENT);
    }
    private static String time(long value) { return TIME.format(Instant.ofEpochMilli(value).atZone(ZoneId.systemDefault())); }
    private static String place(SchedulePlan.Event event) { return event.location.isEmpty() ? "地点未设置" : event.location; }
    private static void showReminder(Context context, SchedulePlan.Point point, long now) {
        SchedulePlan.Event event = point.event;
        boolean resume = point.type == SchedulePlan.CONTINUE;
        boolean exam = "exam".equals(event.type);
        String title = (resume ? "课间结束 · " : exam ? "准备考试 · " : "准备上课 · ") + event.name;
        String text = place(event) + " · " + time(resume ? point.at : event.start) + (resume ? " 继续上课" : " 开始")
                + " · " + time(event.end) + (exam ? " 结束" : " 下课");
        Notification notification = base(context, REMINDERS).setContentTitle(title).setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text)).setAutoCancel(true)
                .setTimeoutAfter(Math.max(1000, event.end - now)).build();
        try { context.getSystemService(NotificationManager.class).notify(event.id, REMINDER_ID, notification); }
        catch (SecurityException ignored) { /* User can revoke notifications at any point. */ }
    }
    private static void showStatus(Context context, SchedulePlan.State state, long now, boolean elapsedMode) {
        StatusPresentation display = new StatusPresentation(state, now, SystemClock.elapsedRealtime(), elapsedMode, ZoneId.systemDefault());
        Notification notification = base(context, STATUS).setContentTitle(display.title)
                .setContentText(display.fallback).setSubText(display.label)
                .setStyle(new Notification.DecoratedCustomViewStyle())
                .setCustomContentView(statusView(context, display, false))
                .setCustomBigContentView(statusView(context, display, true))
                .setWhen(display.when).setShowWhen(true)
                .setUsesChronometer(true).setChronometerCountDown(display.countdown)
                .setOngoing(true).setOnlyAlertOnce(true)
                // If an inexact alarm is delayed, never leave a negative timer or stale class card.
                .setTimeoutAfter(display.timeout).build();
        try { context.getSystemService(NotificationManager.class).notify(STATUS_ID, notification); }
        catch (SecurityException ignored) { }
    }
    private static RemoteViews statusView(Context context, StatusPresentation display, boolean expanded) {
        RemoteViews view = new RemoteViews(context.getPackageName(), expanded ? R.layout.notification_status_big : R.layout.notification_status_small);
        view.setTextViewText(R.id.status_title, display.title);
        view.setChronometerCountDown(R.id.status_clock, display.countdown);
        view.setChronometer(R.id.status_clock, display.chronometerBase, display.label + " %s", true);
        if (expanded) {
            view.setTextViewText(R.id.status_details, display.details);
            view.setTextViewText(R.id.status_elapsed_detail, display.elapsedDetail);
            view.setViewVisibility(R.id.status_elapsed_detail, display.elapsedDetail.isEmpty() ? View.GONE : View.VISIBLE);
        }
        return view;
    }
    static void test(Context context) {
        createChannels(context);
        if (!granted(context)) return;
        Notification notification = base(context, REMINDERS).setContentTitle("清课 · 通知测试")
                .setContentText("通知可以显示；课程提醒将按你设置的时间发送")
                .setAutoCancel(true).setTimeoutAfter(60_000).build();
        try { context.getSystemService(NotificationManager.class).notify(TEST_ID, notification); }
        catch (SecurityException ignored) { }
    }
}
