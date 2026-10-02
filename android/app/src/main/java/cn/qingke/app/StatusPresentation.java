package cn.qingke.app;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** Pure presentation/time-base calculation; both notification layouts use the same values. */
final class StatusPresentation {
    final String title, label, details, fallback, elapsedDetail;
    final boolean countdown;
    final long when, chronometerBase, timeout;

    StatusPresentation(SchedulePlan.State state, long now, long elapsedRealtime, boolean elapsedMode, ZoneId zone) {
        boolean inClass = "class".equals(state.kind), onBreak = "break".equals(state.kind);
        boolean exam = "exam".equals(state.event.type);
        String phase = inClass ? (exam ? "考试中" : "上课中") : onBreak ? "课间休息" : (exam ? "即将考试" : "即将上课");
        String action = inClass ? (exam ? "考试结束" : state.until < state.event.end ? "课间" : "下课")
                : onBreak ? "继续上课" : (exam ? "开考" : "开始上课");
        countdown = !(inClass && elapsedMode);
        label = countdown ? "距" + action : (exam ? "已考试" : "累计授课");
        long value = countdown ? Math.max(0, state.until - now) : state.elapsed;
        when = countdown ? state.until : now - state.elapsed;
        chronometerBase = elapsedRealtime + when - now;
        timeout = Math.max(1000, state.until - now);
        title = state.event.name + " · " + phase;
        String endpoint = DateTimeFormatter.ofPattern("HH:mm", Locale.CHINA).format(Instant.ofEpochMilli(state.until).atZone(zone));
        String location = state.event.location.isEmpty() ? "地点未设置" : state.event.location;
        details = location + " · " + endpoint + " " + action;
        // Standard text is retained for launchers/accessibility surfaces which omit custom views.
        // Clearly mark it as a snapshot, since only the system Chronometer updates every second.
        fallback = label + " " + duration(value) + "（更新时） · " + details;
        elapsedDetail = onBreak ? "已授课 " + duration(state.elapsed) + " · 课间不计入授课时间"
                : (!countdown && !exam ? "不含课间休息" : "");
    }

    static String duration(long milliseconds) {
        long seconds = Math.max(0, milliseconds) / 1000;
        return seconds >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
                : String.format(Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60);
    }
}
