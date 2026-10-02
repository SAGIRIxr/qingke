package cn.qingke.app;

import java.time.ZoneId;
import java.util.List;

public final class StatusPresentationTest {
    private static int checks;
    private static final long M = 60_000L, START = 1_800_000_000_000L, UPTIME = 10_000_000;
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    public static void main(String[] args) {
        SchedulePlan.Event event = new SchedulePlan.Event("1", "高等数学", "A101", START, START + 100 * M,
                List.of(new SchedulePlan.Segment(START, START + 45 * M), new SchedulePlan.Segment(START + 55 * M, START + 100 * M)));
        SchedulePlan plan = new SchedulePlan(false, true, false, 10, List.of(event));
        StatusPresentation before = new StatusPresentation(plan.stateAt(START - 5 * M), START - 5 * M, UPTIME, true, ZONE);
        check(before.countdown && before.label.equals("距开始上课"), "Before class always counts down even in elapsed mode");
        check(before.chronometerBase == UPTIME + 5 * M, "Countdown base uses elapsedRealtime rather than epoch");
        check(before.fallback.contains("05:00") && before.fallback.contains("更新时"), "Fallback contains a labeled numeric snapshot");
        StatusPresentation current = new StatusPresentation(plan.stateAt(START + 20 * M), START + 20 * M, UPTIME, false, ZONE);
        check(current.label.equals("距课间") && current.chronometerBase == UPTIME + 25 * M, "First section countdown reaches break");
        check(current.timeout == 25 * M, "Status expires at the displayed boundary");
        check(current.title.contains("高等数学") && current.title.contains("上课中"), "Title has course and current phase");
        check(current.details.contains("A101"), "Expanded state retains classroom");
        StatusPresentation pause = new StatusPresentation(plan.stateAt(START + 50 * M), START + 50 * M, UPTIME, true, ZONE);
        check(pause.countdown && pause.label.equals("距继续上课"), "Break counts down even if elapsed is selected");
        check(pause.chronometerBase == UPTIME + 5 * M, "Break clock reaches second subsection");
        check(pause.elapsedDetail.contains("45:00"), "Elapsed freezes at 45 minutes during break");
        StatusPresentation after = new StatusPresentation(plan.stateAt(START + 65 * M), START + 65 * M, UPTIME, true, ZONE);
        check(!after.countdown && after.label.equals("累计授课"), "Second section resumes elapsed chronometer");
        check(after.chronometerBase == UPTIME - 55 * M, "Elapsed chronometer excludes the ten-minute break");
        check(after.when == START + 10 * M, "Standard template fallback shares correct accumulated base");
        StatusPresentation last = new StatusPresentation(plan.stateAt(START + 65 * M), START + 65 * M, UPTIME, false, ZONE);
        check(last.label.equals("距下课") && last.chronometerBase == UPTIME + 35 * M, "Last section countdown reaches course end");
        SchedulePlan.Event exam = new SchedulePlan.Event("exam:1", "大学英语", "B102", START, START + 90 * M,
                List.of(new SchedulePlan.Segment(START, START + 90 * M)), "exam");
        SchedulePlan exams = new SchedulePlan(true, true, false, 10, List.of(exam));
        StatusPresentation takingExam = new StatusPresentation(exams.stateAt(START + M), START + M, UPTIME, false, ZONE);
        check(takingExam.title.contains("考试中") && takingExam.label.equals("距考试结束"), "Absolute exam events use exam labels");
        check(new StatusPresentation(exams.stateAt(START - M), START - M, UPTIME, false, ZONE).label.equals("距开考"), "Exam reminder label");
        check(StatusPresentation.duration(-1).equals("00:00"), "Fallback never displays negative countdown");
        check(StatusPresentation.duration(65 * M + 3_000).equals("1:05:03"), "Long exam duration is not truncated");
        System.out.println("PASS: " + checks + " notification presentation checks");
    }
}
