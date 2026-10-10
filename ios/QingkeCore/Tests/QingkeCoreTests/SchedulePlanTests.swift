import XCTest
@testable import QingkeCore

/// Mirrors android/native-tests/cn/qingke/app/SchedulePlanTest.java so both shells agree on time selection.
final class SchedulePlanTests: XCTestCase {
    private let m: Int64 = 60_000
    private let start: Int64 = 1_800_000_000_000

    private func course(_ id: String, _ begin: Int64) -> SchedulePlan.Event {
        SchedulePlan.Event(id: id, name: "高等数学", location: "A101", start: begin, end: begin + 100 * m,
                           segments: [.init(start: begin, end: begin + 45 * m), .init(start: begin + 55 * m, end: begin + 100 * m)])
    }

    func testStatusBoundaries() {
        let plan = SchedulePlan(enabled: true, ongoing: true, breakReminder: true, minutes: 10, events: [course("1", start)])
        XCTAssertNil(plan.stateAt(start - 11 * m))
        XCTAssertEqual(plan.stateAt(start - 10 * m)?.kind, "before")
        XCTAssertEqual(plan.nextAfter(start - 11 * m), start - 10 * m)
        XCTAssertEqual(plan.nextAfter(start - 10 * m), start)
        XCTAssertEqual(plan.stateAt(start)?.kind, "class")
        XCTAssertEqual(plan.stateAt(start + 20 * m)?.until, start + 45 * m)
        XCTAssertEqual(plan.stateAt(start + 20 * m)?.elapsed, 20 * m)
        XCTAssertEqual(plan.stateAt(start + 45 * m)?.kind, "break")
        XCTAssertEqual(plan.stateAt(start + 50 * m)?.until, start + 55 * m)
        XCTAssertEqual(plan.stateAt(start + 50 * m)?.elapsed, 45 * m)
        XCTAssertEqual(plan.stateAt(start + 65 * m)?.elapsed, 55 * m)
        XCTAssertNil(plan.stateAt(start + 100 * m))
        XCTAssertEqual(plan.nextAfter(start + 100 * m), 0)
    }

    func testSwitchesAndPointCounts() {
        let event = course("1", start)
        let disabled = SchedulePlan(enabled: false, ongoing: false, breakReminder: true, minutes: 10, events: [event])
        XCTAssertEqual(disabled.nextAfter(start - 20 * m), 0)
        XCTAssertNil(disabled.stateAt(start))
        let alertOnly = SchedulePlan(enabled: true, ongoing: false, breakReminder: false, minutes: 10, events: [event])
        XCTAssertNil(alertOnly.stateAt(start))
        XCTAssertEqual(alertOnly.nextAfter(start - 10 * m), event.end)
        XCTAssertEqual(alertOnly.points.count, 2)
        let alertWithBreak = SchedulePlan(enabled: true, ongoing: false, breakReminder: true, minutes: 10, events: [event])
        XCTAssertEqual(alertWithBreak.nextAfter(start - 10 * m), start + 55 * m)
        XCTAssertEqual(SchedulePlan(enabled: true, ongoing: true, breakReminder: false, minutes: 0, events: [event]).nextAfter(start - 1), start)
    }

    func testOverlapPrefersActiveCourse() {
        let overlap = SchedulePlan(enabled: true, ongoing: true, breakReminder: false, minutes: 10,
                                   events: [course("2", start + 95 * m), course("1", start)])
        XCTAssertEqual(overlap.stateAt(start + 90 * m)?.event.id, "1")
        XCTAssertEqual(overlap.stateAt(start + 100 * m)?.event.id, "2")
    }

    func testPendingAlertsRespectIOSLimit() {
        let events = (0..<100).map { course(String($0), start + Int64($0) * 120 * m) }
        let plan = SchedulePlan(enabled: true, ongoing: true, breakReminder: true, minutes: 10, events: events)
        let (alerts, hasMore) = plan.pendingAlerts(after: start - 11 * m, limit: 62)
        XCTAssertEqual(alerts.count, 62)
        XCTAssertTrue(hasMore)
        XCTAssertTrue(alerts.allSatisfy { $0.kind != .state })
        XCTAssertEqual(alerts[0].kind, .reminder)
        XCTAssertEqual(alerts[0].at, start - 10 * m)
        XCTAssertEqual(alerts[1].kind, .resume)
        XCTAssertEqual(alerts[1].at, start + 55 * m)
        XCTAssertEqual(zip(alerts, alerts.dropFirst()).allSatisfy { $0.at <= $1.at }, true)
        let tail = plan.pendingAlerts(after: start + 99 * 120 * m, limit: 62)
        XCTAssertEqual(tail.alerts.map(\.kind), [.resume])
        XCTAssertFalse(tail.hasMore)
        let continuous = SchedulePlan.Event(id: "c", name: "实验", location: "", start: start, end: start + 90 * m,
                                            segments: [.init(start: start, end: start + 45 * m), .init(start: start + 45 * m, end: start + 90 * m)])
        XCTAssertEqual(SchedulePlan(enabled: true, ongoing: false, breakReminder: true, minutes: 10, events: [continuous])
            .pendingAlerts(after: 0, limit: 62).alerts.count, 1, "No resume alert without a real break")
    }

    func testParseMatchesAndroidValidation() throws {
        let json = """
        {"enabled":true,"ongoing":false,"breakReminder":true,"minutes":15,"statusMode":"elapsed","events":[
          {"id":"exam:1","name":"期末","location":"","start":\(start + 200 * m),"end":\(start + 260 * m)},
          {"id":"c1","type":"course","name":"高数","location":"A101","start":\(start),"end":\(start + 100 * m),
           "segments":[{"start":\(start + 55 * m),"end":\(start + 100 * m)},{"start":\(start),"end":\(start + 45 * m)}]}]}
        """
        let plan = try SchedulePlan.parse(json: json)
        XCTAssertEqual(plan.minutes, 15)
        XCTAssertEqual(plan.statusMode, "elapsed")
        XCTAssertEqual(plan.events.map(\.id), ["c1", "exam:1"])
        XCTAssertEqual(plan.events[0].segments.first?.start, start)
        XCTAssertTrue(plan.events[1].isExam)

        func rejects(_ body: String, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
            XCTAssertThrowsError(try SchedulePlan.parse(json: body), file: file, line: line) { error in
                XCTAssertEqual((error as? SchedulePlan.ParseError)?.errorDescription, message, file: file, line: line)
            }
        }
        rejects(#"{"events":[{"id":"a","name":"x","start":\#(start),"end":\#(start)}]}"#, "课程时间或标识无效")
        rejects(#"{"events":[{"id":"a","name":"x","start":true,"end":\#(start + m)}]}"#, "课程时间或标识无效")
        rejects(#"{"events":[{"id":"a","name":"x","start":\#(start),"end":\#(start + m)},{"id":"a","name":"y","start":\#(start),"end":\#(start + m)}]}"#, "课程时间或标识无效")
        rejects(#"{"events":[{"id":"a","name":"x","start":\#(start),"end":\#(start + 10 * m),"segments":[{"start":\#(start),"end":\#(start + 11 * m)}]}]}"#, "小节时间超出课程范围")
        rejects(#"{"events":[{"id":"a","name":"x","start":\#(start),"end":\#(start + 10 * m),"segments":[{"start":\#(start),"end":\#(start + 5 * m)}]}]}"#, "课程起止时间与小节不一致")
        rejects(#"{"events":[{"id":"a","name":"x","start":\#(start),"end":\#(start + 10 * m),"segments":[{"start":\#(start),"end":\#(start + 6 * m)},{"start":\#(start + 5 * m),"end":\#(start + 10 * m)}]}]}"#, "课程小节时间重叠")
    }

    func testReminderWordingMatchesAndroid() throws {
        let zone = TimeZone(identifier: "Asia/Shanghai")!
        // 2027-01-15 08:00 Asia/Shanghai
        let begin: Int64 = 1_799_942_400_000 + 8 * 60 * m
        let plan = SchedulePlan(enabled: true, ongoing: false, breakReminder: true, minutes: 10, events: [course("1", begin)])
        let alerts = plan.pendingAlerts(after: 0, limit: 10).alerts
        let first = ReminderText.content(for: alerts[0], timeZone: zone)
        XCTAssertEqual(first.title, "高等数学 · 准备上课")
        XCTAssertEqual(first.body, "A101 · 08:00 上课 · 09:40 下课")
        let resume = ReminderText.content(for: alerts[1], timeZone: zone)
        XCTAssertEqual(resume.title, "高等数学 · 课间结束")
        XCTAssertEqual(resume.body, "A101 · 08:55 续课 · 09:40 下课")
    }
}
