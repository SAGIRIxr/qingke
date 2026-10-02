package cn.qingke.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** Run with android/test-notifications.ps1; no Android runtime or third-party test library required. */
public final class SchedulePlanTest {
    private static int checks;
    private static final long M = 60_000L, START = 1_800_000_000_000L;
    private static void check(boolean result, String label) {
        checks++;
        if (!result) throw new AssertionError(label);
    }
    private static SchedulePlan.Event course(String id, long start) {
        return new SchedulePlan.Event(id, "高等数学", "A101", start, start + 100 * M,
                List.of(new SchedulePlan.Segment(start, start + 45 * M),
                        new SchedulePlan.Segment(start + 55 * M, start + 100 * M)));
    }
    public static void main(String[] args) {
        SchedulePlan.Event event = course("1", START);
        SchedulePlan plan = new SchedulePlan(true, true, true, 10, List.of(event));
        check(plan.stateAt(START - 11 * M) == null, "No all-day status before reminder window");
        check("before".equals(plan.stateAt(START - 10 * M).kind), "Window begins exactly at reminder");
        check(plan.nextAfter(START - 11 * M) == START - 10 * M, "Next point is reminder");
        check(plan.nextAfter(START - 10 * M) == START, "Equal timestamps are consumed together");
        check("class".equals(plan.stateAt(START).kind), "Class starts at exact boundary");
        check(plan.stateAt(START + 20 * M).until == START + 45 * M, "Countdown uses current subsection");
        check(plan.stateAt(START + 20 * M).elapsed == 20 * M, "Elapsed initial subsection");
        check("break".equals(plan.stateAt(START + 45 * M).kind), "Break starts at exact boundary");
        check(plan.stateAt(START + 50 * M).until == START + 55 * M, "Break countdown targets restart");
        check(plan.stateAt(START + 50 * M).elapsed == 45 * M, "Break is excluded from elapsed");
        check("class".equals(plan.stateAt(START + 55 * M).kind), "Second subsection resumes");
        check(plan.stateAt(START + 65 * M).elapsed == 55 * M, "Elapsed excludes past break");
        check(plan.stateAt(START + 100 * M) == null, "Status disappears at course end");
        check(plan.nextAfter(START + 100 * M) == 0, "Finished plan has no alarm");
        check(plan.remindersDue(START - 10 * M, START - 10 * M).size() == 1, "One reminder for whole lesson");
        check(plan.remindersDue(START + 55 * M, START + 55 * M).size() == 1, "Optional break resume reminder");
        check(plan.remindersDue(START - 10 * M, START - M).size() == 1, "Delayed reminder still warns before class");
        check(plan.remindersDue(START - 10 * M, START + 5 * M).isEmpty(), "Stale pre-class reminder suppressed");
        check(plan.remindersDue(START + 55 * M, START + 58 * M).isEmpty(), "Stale resume reminder suppressed");
        check(plan.remindersDue(START - 10 * M, START + 101 * M).isEmpty(), "Finished course never alerts");
        check(plan.remindersDue(START - 10 * M, START - 11 * M).isEmpty(), "Clock moved backwards: no premature alert");
        String sent = plan.remindersDue(START - 10 * M, START - 10 * M).get(0).key();
        check(plan.remindersDue(START - 10 * M, START - 10 * M, Set.of(sent)).isEmpty(), "Reboot or clock rollback cannot duplicate delivered reminder");
        check(plan.remindersDue(START + 55 * M, START + 55 * M, Set.of(sent)).size() == 1, "Pre-class ledger does not suppress optional break reminder");
        SchedulePlan moved = new SchedulePlan(true, true, true, 10, List.of(course("1", START + 120 * M)));
        check(moved.remindersDue(START + 110 * M, START + 110 * M, Set.of(sent)).size() == 1, "Rescheduled occurrence has a new reminder identity");
        SchedulePlan disabled = new SchedulePlan(false, false, true, 10, List.of(event));
        check(disabled.nextAfter(START - 20 * M) == 0 && disabled.stateAt(START) == null, "Both switches off cancels everything");
        SchedulePlan statusOnly = new SchedulePlan(false, true, true, 10, List.of(event));
        check(statusOnly.remindersDue(START - 10 * M, START).isEmpty(), "Status independently enabled without alerts");
        check(statusOnly.stateAt(START) != null, "Status-only mode works");
        SchedulePlan alertOnly = new SchedulePlan(true, false, false, 10, List.of(event));
        check(alertOnly.stateAt(START) == null, "Alerts independently enabled without status");
        check(alertOnly.remindersDue(START + 55 * M, START + 55 * M).isEmpty(), "Break reminder defaults off");
        SchedulePlan instant = new SchedulePlan(true, true, false, 0, List.of(event));
        check(instant.nextAfter(START - 1) == START, "Zero-minute reminder supported");
        SchedulePlan.Event later = course("2", START + 95 * M);
        SchedulePlan overlap = new SchedulePlan(true, true, false, 10, List.of(later, event));
        check(overlap.stateAt(START + 90 * M).event.id.equals("1"), "Active course beats next reminder window");
        check(overlap.stateAt(START + 100 * M).event.id.equals("2"), "Next course takes over after earlier end");
        SchedulePlan.Event continuous = new SchedulePlan.Event("continuous", "实验", "B201", START, START + 90 * M,
                List.of(new SchedulePlan.Segment(START, START + 45 * M), new SchedulePlan.Segment(START + 45 * M, START + 90 * M)));
        check(new SchedulePlan(true, true, true, 10, List.of(continuous)).remindersDue(START + 45 * M, START + 45 * M).isEmpty(), "No resume alert without a break");
        List<SchedulePlan.Event> semester = new ArrayList<>();
        for (int i = 0; i < 10000; i++) semester.add(course(Integer.toString(i), START + i * 120 * M));
        SchedulePlan large = new SchedulePlan(true, true, false, 10, semester);
        check(large.nextAfter(START + 9998 * 120 * M + 110 * M) == START + 9999 * 120 * M, "Large semester chooses correct remaining point");
        check(new SchedulePlan(true, true, true, 10, List.of()).nextAfter(START) == 0, "Empty replacement clears scheduled events");
        System.out.println("PASS: " + checks + " native schedule checks");
    }
}
