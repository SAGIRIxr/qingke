package cn.qingke.app;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/** Pure time-selection logic, shared by the Android scheduler and the JVM checks. */
final class SchedulePlan {
    static final long MINUTE = 60_000L;
    static final int REMINDER = 1, CONTINUE = 2, STATE = 3;
    static final class Segment {
        final long start, end;
        Segment(long start, long end) { this.start = start; this.end = end; }
    }
    static final class Event {
        final String id, name, location, type;
        final long start, end;
        final List<Segment> segments;
        Event(String id, String name, String location, long start, long end, List<Segment> segments) {
            this(id, name, location, start, end, segments, "course");
        }
        Event(String id, String name, String location, long start, long end, List<Segment> segments, String type) {
            this.id = id; this.name = name; this.location = location;
            this.start = start; this.end = end; this.segments = segments;
            this.type = "exam".equals(type) ? "exam" : "course";
        }
    }
    static final class Point {
        final long at;
        final int type;
        final Event event;
        Point(long at, int type, Event event) { this.at = at; this.type = type; this.event = event; }
        String key() { return event.id + "\n" + type + "\n" + at; }
    }
    static final class State {
        final Event event;
        final String kind;
        final long until, elapsed;
        State(Event event, String kind, long until, long elapsed) {
            this.event = event; this.kind = kind; this.until = until; this.elapsed = elapsed;
        }
    }
    final boolean enabled, ongoing, breakReminder;
    final int minutes;
    final List<Event> events;
    SchedulePlan(boolean enabled, boolean ongoing, boolean breakReminder, int minutes, List<Event> events) {
        this.enabled = enabled; this.ongoing = ongoing; this.breakReminder = breakReminder;
        this.minutes = Math.max(0, Math.min(120, minutes));
        this.events = events;
    }
    List<Point> points() {
        List<Point> points = new ArrayList<>();
        if (!enabled && !ongoing) return points;
        for (Event event : events) {
            long before = event.start - minutes * MINUTE;
            if (enabled) points.add(new Point(before, REMINDER, event));
            if (ongoing) points.add(new Point(before, STATE, event));
            // End/start points also remove an expired reminder when ongoing is off.
            points.add(new Point(event.start, STATE, event));
            points.add(new Point(event.end, STATE, event));
            for (int i = 0; i < event.segments.size(); i++) {
                Segment segment = event.segments.get(i);
                if (ongoing) {
                    points.add(new Point(segment.start, STATE, event));
                    points.add(new Point(segment.end, STATE, event));
                }
                if (enabled && breakReminder && i > 0 && segment.start > event.segments.get(i - 1).end)
                    points.add(new Point(segment.start, CONTINUE, event));
            }
        }
        points.sort(Comparator.comparingLong(point -> point.at));
        return points;
    }
    long nextAfter(long now) {
        for (Point point : points()) if (point.at > now) return point.at;
        return 0;
    }
    List<Point> remindersDue(long scheduledAt, long now) {
        return remindersDue(scheduledAt, now, Collections.emptySet());
    }
    List<Point> remindersDue(long scheduledAt, long now, Set<String> delivered) {
        List<Point> due = new ArrayList<>();
        if (!enabled || scheduledAt <= 0 || now < scheduledAt) return due;
        for (Point point : points()) {
            if (point.at < scheduledAt || point.at > now || point.type == STATE || delivered.contains(point.key())) continue;
            // A delayed alarm can still warn before class. Never alert for an already-finished class.
            if (point.event.end <= now) continue;
            if (point.type == REMINDER && now < point.event.start + 2 * MINUTE) due.add(point);
            if (point.type == CONTINUE && now - point.at < 2 * MINUTE) due.add(point);
        }
        return due;
    }
    State stateAt(long now) {
        if (!ongoing) return null;
        Event selected = null;
        // An in-progress class takes priority over the following class's reminder window.
        for (Event event : events) {
            if (now >= event.end || now < event.start - minutes * MINUTE) continue;
            if (selected == null || (now >= event.start && now < selected.start)
                    || ((now >= event.start) == (now >= selected.start) && event.start < selected.start)) selected = event;
        }
        if (selected == null) return null;
        if (now < selected.start) return new State(selected, "before", selected.start, 0);
        long elapsed = 0;
        for (Segment segment : selected.segments) {
            if (now < segment.start) return new State(selected, "break", segment.start, elapsed);
            elapsed += Math.max(0, Math.min(now, segment.end) - segment.start);
            if (now < segment.end) return new State(selected, "class", segment.end, elapsed);
        }
        return new State(selected, "class", selected.end, elapsed);
    }
}
